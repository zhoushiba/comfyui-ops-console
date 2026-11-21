/**
 * 内存任务仓库：模拟 ComfyUI 的 prompt 队列与执行进度。
 * 真实 ComfyUI 通过 WebSocket 推送 progress，mock 额外提供
 * /mock/progress/{id} 便于编排层与前端观察 0→100% 中间态。
 */
import { randomUUID } from 'node:crypto';
import type { PromptGraph } from './graph.js';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface MockOutputImage {
  filename: string;
  subfolder: string;
  type: string;
}

export interface MockJob {
  promptId: string;
  number: number;
  graph: PromptGraph;
  clientId: string;
  outputNodeIds: string[];
  receivedAt: number;
  durationMs: number;
  status: JobStatus;
  outputs: Record<string, { images: MockOutputImage[] }>;
  failReason?: string;
}

export interface JobProgress {
  promptId: string;
  status: JobStatus;
  progress: number;
  stage: 'queued' | 'sampling' | 'decoding' | 'done';
  elapsedMs: number;
  etaMs: number;
}

export class JobStore {
  private readonly jobs = new Map<string, MockJob>();
  private sequence = 0;

  create(input: {
    graph: PromptGraph;
    clientId: string;
    outputNodeIds: string[];
    durationMs: number;
    now?: number;
  }): MockJob {
    this.sequence += 1;
    const job: MockJob = {
      promptId: randomUUID(),
      number: this.sequence,
      graph: input.graph,
      clientId: input.clientId,
      outputNodeIds: input.outputNodeIds,
      receivedAt: input.now ?? Date.now(),
      durationMs: input.durationMs,
      status: 'queued',
      outputs: {},
    };
    this.jobs.set(job.promptId, job);
    return job;
  }

  get(promptId: string): MockJob | undefined {
    return this.jobs.get(promptId);
  }

  list(): MockJob[] {
    return [...this.jobs.values()].sort((a, b) => a.number - b.number);
  }

  get count(): number {
    return this.jobs.size;
  }

  clear(): void {
    this.jobs.clear();
    this.sequence = 0;
  }

  /**
   * 根据当前时间推进任务状态，返回可观测进度。
   * partial 模式下进度永远停在 60%，用于验证"上游永远不完成 → 本地 timeout"。
   */
  progress(job: MockJob, mode: 'ok' | 'slow' | 'fail' | 'partial', now = Date.now()): JobProgress {
    const elapsedMs = Math.max(0, now - job.receivedAt);
    const ratio = Math.min(1, elapsedMs / job.durationMs);

    if (job.status === 'failed') {
      return { promptId: job.promptId, status: 'failed', progress: 0, stage: 'queued', elapsedMs, etaMs: 0 };
    }

    if (mode === 'partial') {
      return {
        promptId: job.promptId,
        status: 'running',
        progress: Math.min(60, Math.round(ratio * 60)),
        stage: 'sampling',
        elapsedMs,
        etaMs: Number.POSITIVE_INFINITY,
      };
    }

    if (ratio >= 1) {
      job.status = 'completed';
      this.fillOutputs(job);
      return {
        promptId: job.promptId,
        status: 'completed',
        progress: 100,
        stage: 'done',
        elapsedMs,
        etaMs: 0,
      };
    }

    job.status = 'running';
    return {
      promptId: job.promptId,
      status: 'running',
      progress: Math.round(ratio * 100),
      stage: ratio > 0.7 ? 'decoding' : 'sampling',
      elapsedMs,
      etaMs: Math.max(0, job.durationMs - elapsedMs),
    };
  }

  /** 任务完成时补齐 outputs；文件名里带 node id，方便与 /view 对应 */
  fillOutputs(job: MockJob): void {
    if (Object.keys(job.outputs).length > 0) return;
    for (const nodeId of job.outputNodeIds) {
      job.outputs[nodeId] = {
        images: [
          {
            filename: `ComfyUI_${String(job.number).padStart(5, '0')}_${nodeId}.png`,
            subfolder: 'mock',
            type: 'output',
          },
        ],
      };
    }
  }
}
