/**
 * 任务编排器：把一次出图拆成可观测的状态机。
 *
 *   queued → submitted → running → polling → downloading → completed
 *                                      ↘ failed / timeout / unreachable
 *
 * 设计要点：
 *  - 并发受 ORCHESTRATOR_CONCURRENCY 限制，排队任务在本进程内串行取号；
 *  - 提交/轮询/下载任一阶段遇到可重试错误，按指数退避重新排队，次数上限 MAX_RETRIES；
 *  - 错误分类决定最终状态：连接被拒→unreachable、总超时→timeout、其余→failed；
 *  - 下载后先校验魔数并完整解码，再落盘；缩略图/WebP 转换失败不影响原图；
 *  - 终态写 usage_record，供统计与结算。
 */
import type { AppConfig } from '../config.js';
import { AppError } from '../lib/errors.js';
import { detectImageFormat, extensionForFormat, mimeForFormat, probeImage } from '../lib/image.js';
import { nowIso, toDateKey } from '../db/knex.js';
import { ComfyUiError, type ComfyHistoryImage, type ComfyUiClient } from './comfyuiClient.js';
import { computeBackoff, type ComfyUiPoller } from './poller.js';
import type { ImageConverter } from './imageConverter.js';
import type { StorageService } from './storage.js';
import type { TaskRepository, TaskRow, TaskStatus } from '../repositories/taskRepo.js';
import type { ImageRepository } from '../repositories/imageRepo.js';
import type { UsageRepository } from '../repositories/usageRepo.js';

export interface OrchestratorLogger {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface OrchestratorDeps {
  config: AppConfig;
  client: ComfyUiClient;
  poller: ComfyUiPoller;
  storage: StorageService;
  converter: ImageConverter;
  tasks: TaskRepository;
  images: ImageRepository;
  usage: UsageRepository;
  logger: OrchestratorLogger;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface OrchestratorStats {
  concurrency: number;
  running: number;
  queued: number;
  completedSinceBoot: number;
  failedSinceBoot: number;
}

const TERMINAL_STATUSES: TaskStatus[] = ['completed', 'failed', 'timeout', 'unreachable'];

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** GPU 秒数估算：单张按 1.2s + 实际耗时的一半，仅用于成本参考 */
export function estimateGpuSeconds(durationMs: number, imageCount: number): number {
  const estimate = (durationMs / 1000) * 0.5 + imageCount * 1.2;
  return Math.max(0, Math.round(estimate));
}

/** 把未知异常分类成"最终状态 + 错误码"，是状态机的判定核心 */
export function classifyFailure(error: unknown): {
  status: TaskStatus;
  code: string;
  message: string;
  detail: string | null;
  httpStatus: number | null;
  retriable: boolean;
} {
  if (error instanceof ComfyUiError) {
    const base = {
      message: error.message,
      detail: error.bodyText ? error.bodyText.slice(0, 4000) : null,
      httpStatus: error.status ?? null,
      retriable: error.retriable,
    };
    switch (error.kind) {
      case 'timeout':
        return { ...base, status: 'timeout', code: 'COMFYUI_TIMEOUT' };
      case 'unreachable':
        return { ...base, status: 'unreachable', code: 'COMFYUI_UNREACHABLE' };
      case 'http':
        return { ...base, status: 'failed', code: 'COMFYUI_HTTP_ERROR' };
      default:
        return { ...base, status: 'failed', code: 'COMFYUI_INVALID_RESPONSE' };
    }
  }
  if (error instanceof AppError) {
    return {
      status: 'failed',
      code: error.code,
      message: error.message,
      detail: error.details === undefined ? null : JSON.stringify(error.details).slice(0, 4000),
      httpStatus: null,
      retriable: false,
    };
  }
  return {
    status: 'failed',
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : String(error),
    detail: null,
    httpStatus: null,
    retriable: false,
  };
}

export class TaskOrchestrator {
  private readonly deps: OrchestratorDeps;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  private readonly queue: number[] = [];
  private readonly running = new Map<number, Promise<void>>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private stopped = false;
  private completedSinceBoot = 0;
  private failedSinceBoot = 0;

  constructor(deps: OrchestratorDeps) {
    this.deps = deps;
    this.sleep = deps.sleep ?? defaultSleep;
    this.now = deps.now ?? Date.now;
  }

  get stats(): OrchestratorStats {
    return {
      concurrency: this.deps.config.orchestratorConcurrency,
      running: this.running.size,
      queued: this.queue.length,
      completedSinceBoot: this.completedSinceBoot,
      failedSinceBoot: this.failedSinceBoot,
    };
  }

  /** 投递任务（幂等：同一个 id 重复入队只会被执行一次） */
  enqueue(taskId: number): void {
    if (this.stopped) return;
    if (!this.queue.includes(taskId) && !this.running.has(taskId)) {
      this.queue.push(taskId);
    }
    this.tick();
  }

  private tick(): void {
    if (this.stopped) return;
    while (this.running.size < this.deps.config.orchestratorConcurrency && this.queue.length > 0) {
      const taskId = this.queue.shift() as number;
      if (this.running.has(taskId)) continue;
      const promise = this.run(taskId)
        .catch((error) => {
          this.deps.logger.error({ err: error, taskId }, '任务执行器未捕获异常');
        })
        .finally(() => {
          this.running.delete(taskId);
          this.tick();
        });
      this.running.set(taskId, promise);
    }
  }

  /** 单次尝试：提交 → 轮询 → 下载 → 落库 */
  private async run(taskId: number): Promise<void> {
    const { tasks, client, poller, images, storage, converter, config, logger } = this.deps;
    const task = await tasks.findById(taskId);
    if (!task) {
      logger.warn({ taskId }, '任务不存在，跳过');
      return;
    }
    if (TERMINAL_STATUSES.includes(task.status)) {
      logger.debug({ taskId, status: task.status }, '任务已处于终态，跳过');
      return;
    }

    const attemptNo = Number(task.attempts) + 1;
    const startedAtIso = nowIso();
    const startedAtMs = this.now();
    let stage: 'submit' | 'poll' | 'download' = 'submit';

    logger.info({ taskId, attemptNo, taskNo: task.task_no }, '开始执行任务');

    try {
      // 重试时清掉上一次可能残留的半成品，保证图片集合不重复
      if (attemptNo > 1) {
        await images.deleteByTask(taskId);
      }

      await tasks.update(taskId, {
        status: 'submitted',
        attempts: attemptNo,
        submitted_at: task.submitted_at ?? startedAtIso,
        progress: 5,
        error_code: null,
        error_message: null,
        error_detail: null,
        image_count: 0,
      });

      let promptId = task.comfyui_prompt_id;
      if (!promptId) {
        const graph = JSON.parse(task.graph_json) as Record<string, unknown>;
        const submitted = await client.submitPrompt(graph, `ops-${task.task_no}`);
        promptId = submitted.promptId;
        await tasks.update(taskId, {
          status: 'running',
          comfyui_prompt_id: promptId,
          started_at: task.started_at ?? nowIso(),
          progress: 10,
        });
      }

      stage = 'poll';
      await tasks.update(taskId, { status: 'polling', progress: 15 });
      const progressTimer = this.startProgressTicker(taskId);
      let pollResult;
      try {
        pollResult = await poller.waitForCompletion(promptId);
      } finally {
        clearInterval(progressTimer);
      }

      stage = 'download';
      await tasks.update(taskId, { status: 'downloading', progress: 95 });

      const collected = this.collectImages(pollResult.history.outputs);
      if (collected.length === 0) {
        throw new ComfyUiError({
          kind: 'invalid_response',
          message: 'ComfyUI 返回完成但 outputs 中没有图片',
          bodyText: JSON.stringify(pollResult.history).slice(0, 4000),
        });
      }

      let saved = 0;
      for (let index = 0; index < collected.length; index += 1) {
        const image = collected[index];
        const downloaded = await poller.withRetry(() => client.downloadImage(image), config.comfyuiMaxRetries);
        // 不信任 Content-Type：先魔数、再完整解码
        const probe = await probeImage(downloaded.buffer, `ComfyUI 图片 ${image.filename}`);
        const format = detectImageFormat(downloaded.buffer) ?? probe.format;
        const filename = `${task.task_no}-${String(index + 1).padStart(2, '0')}.${extensionForFormat(format)}`;
        const relPath = storage.originalRelPath(task.task_no, filename);
        await storage.write(relPath, downloaded.buffer);

        let thumbnailPath: string | null = null;
        try {
          const thumb = await converter.thumbnail(downloaded.buffer, config.thumbnailSize);
          thumbnailPath = storage.thumbnailRelPath(task.task_no, filename);
          await storage.write(thumbnailPath, thumb);
        } catch (error) {
          logger.warn({ err: error, taskId }, '缩略图生成失败，保留原图');
          thumbnailPath = null;
        }

        let convertedPath: string | null = null;
        if (format !== 'webp') {
          try {
            const converted = await converter.convert(downloaded.buffer, 'webp', 82);
            convertedPath = storage.convertedRelPath(task.task_no, filename, 'webp');
            await storage.write(convertedPath, converted.buffer);
          } catch (error) {
            logger.warn({ err: error, taskId }, 'WebP 转换失败，保留原图');
            convertedPath = null;
          }
        }

        await images.create({
          task_id: taskId,
          user_id: task.user_id,
          agent_id: task.agent_id,
          filename,
          storage_path: relPath,
          mime_type: mimeForFormat(format),
          format,
          width: probe.width,
          height: probe.height,
          byte_size: downloaded.buffer.length,
          sha256: probe.sha256,
          thumbnail_path: thumbnailPath,
          converted_path: convertedPath,
          source_image_id: null,
          created_at: nowIso(),
        });
        saved += 1;
      }

      const finishedAt = nowIso();
      const durationMs = this.now() - startedAtMs;
      const gpuSeconds = estimateGpuSeconds(durationMs, saved);
      await tasks.update(taskId, {
        status: 'completed',
        progress: 100,
        finished_at: finishedAt,
        duration_ms: durationMs,
        image_count: saved,
        gpu_seconds: gpuSeconds,
        error_code: null,
        error_message: null,
        error_detail: null,
      });
      await tasks.addAttempt({
        task_id: taskId,
        attempt_no: attemptNo,
        status: 'success',
        stage: 'completed',
        http_status: null,
        error_type: null,
        error_message: null,
        backoff_ms: 0,
        started_at: startedAtIso,
        finished_at: finishedAt,
      });
      await this.recordUsage(task, 'completed', durationMs, saved, gpuSeconds, true);
      this.completedSinceBoot += 1;
      logger.info({ taskId, taskNo: task.task_no, images: saved, durationMs }, '任务完成');
    } catch (error) {
      const failure = classifyFailure(error);
      const finishedAt = nowIso();
      const canRetry = failure.retriable && attemptNo <= this.deps.config.comfyuiMaxRetries;

      if (canRetry) {
        const backoffMs = computeBackoff(attemptNo, 500, 8000);
        await tasks.update(taskId, {
          status: 'queued',
          progress: 0,
          error_code: failure.code,
          error_message: `第 ${attemptNo} 次尝试失败，${backoffMs}ms 后重试：${failure.message}`.slice(0, 1000),
          error_detail: failure.detail,
        });
        await tasks.addAttempt({
          task_id: taskId,
          attempt_no: attemptNo,
          status: 'retrying',
          stage,
          http_status: failure.httpStatus,
          error_type: failure.code,
          error_message: failure.message.slice(0, 1000),
          backoff_ms: backoffMs,
          started_at: startedAtIso,
          finished_at: finishedAt,
        });
        logger.warn({ taskId, attemptNo, backoffMs, code: failure.code }, '任务失败，按指数退避重试');
        this.scheduleRetry(taskId, backoffMs);
        return;
      }

      const durationMs = this.now() - startedAtMs;
      const taskImages = await this.deps.images.listByTask(taskId);
      await tasks.update(taskId, {
        status: failure.status,
        progress: 100,
        finished_at: finishedAt,
        duration_ms: durationMs,
        image_count: taskImages.length,
        error_code: failure.code,
        error_message: failure.message.slice(0, 1000),
        error_detail: failure.detail,
      });
      await tasks.addAttempt({
        task_id: taskId,
        attempt_no: attemptNo,
        status: failure.status,
        stage,
        http_status: failure.httpStatus,
        error_type: failure.code,
        error_message: failure.message.slice(0, 1000),
        backoff_ms: 0,
        started_at: startedAtIso,
        finished_at: finishedAt,
      });
      await this.recordUsage(task, failure.status, durationMs, taskImages.length, 0, false);
      this.failedSinceBoot += 1;
      logger.error({ taskId, code: failure.code, status: failure.status, message: failure.message }, '任务最终失败');
    }
  }

  private scheduleRetry(taskId: number, backoffMs: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.stopped) return;
      this.queue.push(taskId);
      this.tick();
    }, backoffMs);
    timer.unref?.();
    this.timers.add(timer);
  }

  /** 轮询期间推进进度条，让前端能看到 15%→90% 的中间态 */
  private startProgressTicker(taskId: number): NodeJS.Timeout {
    const startedAt = this.now();
    const timer = setInterval(() => {
      const elapsed = this.now() - startedAt;
      const progress = Math.min(90, 15 + Math.floor((elapsed / 1000) * 8));
      void this.deps.tasks
        .update(taskId, { progress })
        .catch((error) => this.deps.logger.debug({ err: error, taskId }, '进度更新失败'));
    }, 250);
    timer.unref?.();
    return timer;
  }

  /** /history 的 outputs 可能是多节点，按节点顺序摊平 */
  private collectImages(outputs: Record<string, { images?: ComfyHistoryImage[] }>): ComfyHistoryImage[] {
    const images: ComfyHistoryImage[] = [];
    for (const output of Object.values(outputs ?? {})) {
      for (const image of output?.images ?? []) {
        if (image?.filename) images.push(image);
      }
    }
    return images;
  }

  private async recordUsage(
    task: TaskRow,
    status: string,
    durationMs: number,
    imageCount: number,
    gpuSeconds: number,
    billable: boolean,
  ): Promise<void> {
    const existing = await this.deps.usage.findByTaskId(task.id);
    if (existing) return;
    let modelName = 'sd_xl_base_1.0.safetensors';
    try {
      const params = JSON.parse(task.params_json ?? '{}') as { modelName?: string; model?: string };
      modelName = params.modelName ?? params.model ?? modelName;
    } catch {
      // 参数损坏时用默认模型名，不阻断统计
    }
    await this.deps.usage.create({
      task_id: task.id,
      user_id: task.user_id,
      agent_id: task.agent_id,
      model_name: modelName,
      status,
      image_count: imageCount,
      duration_ms: durationMs,
      gpu_seconds: gpuSeconds,
      billable,
      occurred_at: toDateKey(),
      created_at: nowIso(),
    });
  }

  /** 等待任务进入终态（E2E 脚本与测试用） */
  async waitFor(taskId: number, timeoutMs = 60_000): Promise<TaskRow> {
    const deadline = this.now() + timeoutMs;
    for (;;) {
      const task = await this.deps.tasks.findById(taskId);
      if (!task) throw new Error(`任务 #${taskId} 不存在`);
      if (TERMINAL_STATUSES.includes(task.status)) return task;
      if (this.now() > deadline) {
        throw new Error(`等待任务 #${taskId} 进入终态超时（${timeoutMs}ms，当前 ${task.status}）`);
      }
      await this.sleep(25);
    }
  }

  /**
   * 服务重启后的自愈：
   *  - 上次进程里执行到一半的任务标记 failed（不重复扣费/重复出图）；
   *  - 仍在 queued 的任务（含等待退避重试的）重新入队。
   */
  async recover(): Promise<{ interrupted: number; resumed: number }> {
    const interrupted = await this.deps.tasks.failInterrupted('服务重启导致任务中断，请重新提交', nowIso());
    if (interrupted > 0) {
      this.deps.logger.warn({ interrupted }, '发现中断任务，已标记失败');
    }
    const pending = await this.deps.tasks.listQueued(200);
    for (const task of pending) this.enqueue(task.id);
    return { interrupted, resumed: pending.length };
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.queue.length = 0;
    // 给正在跑的任务 5s 收尾，避免把 storage 写坏
    await Promise.race([Promise.allSettled([...this.running.values()]), this.sleep(5000)]);
  }
}
