/**
 * 轮询器：把"提交 → 等到完成"的等待逻辑独立出来，便于单测。
 *
 * - 固定间隔轮询 /history/{id}，直到 completed 或总超时；
 * - 每次轮询遇到可重试错误（网络/5xx/超时）按指数退避重试，次数有上限；
 * - 总超时到点抛 kind=timeout，由编排层置任务为 timeout。
 */
import { ComfyUiError, type ComfyHistoryEntry, type ComfyUiClient } from './comfyuiClient.js';

export interface PollerOptions {
  pollIntervalMs: number;
  jobTimeoutMs: number;
  maxRetries: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface PollResult {
  history: ComfyHistoryEntry;
  polls: number;
  retries: number;
  elapsedMs: number;
}

export type BackoffFn = (attempt: number) => number;

/** 第 n 次重试的等待时间：base * 2^(n-1)，封顶 backoffMaxMs */
export function computeBackoff(attempt: number, baseMs = 500, maxMs = 8000): number {
  const safeAttempt = Math.max(1, attempt);
  return Math.min(maxMs, baseMs * 2 ** (safeAttempt - 1));
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class ComfyUiPoller {
  private readonly client: ComfyUiClient;
  private readonly options: Required<Omit<PollerOptions, 'sleep' | 'now'>> & {
    sleep: (ms: number) => Promise<void>;
    now: () => number;
  };

  constructor(client: ComfyUiClient, options: PollerOptions) {
    this.client = client;
    this.options = {
      pollIntervalMs: options.pollIntervalMs,
      jobTimeoutMs: options.jobTimeoutMs,
      maxRetries: options.maxRetries,
      backoffBaseMs: options.backoffBaseMs ?? 500,
      backoffMaxMs: options.backoffMaxMs ?? 8000,
      sleep: options.sleep ?? defaultSleep,
      now: options.now ?? Date.now,
    };
  }

  get backoff(): BackoffFn {
    return (attempt: number) => computeBackoff(attempt, this.options.backoffBaseMs, this.options.backoffMaxMs);
  }

  /** 设置页热更新轮询参数（下一轮轮询生效） */
  configure(patch: Partial<Pick<PollerOptions, 'pollIntervalMs' | 'jobTimeoutMs' | 'maxRetries'>>): void {
    if (patch.pollIntervalMs !== undefined) this.options.pollIntervalMs = patch.pollIntervalMs;
    if (patch.jobTimeoutMs !== undefined) this.options.jobTimeoutMs = patch.jobTimeoutMs;
    if (patch.maxRetries !== undefined) this.options.maxRetries = patch.maxRetries;
  }

  /**
   * 带指数退避的通用重试：仅对 retriable 错误重试，
   * 400（node_errors）这类请求错误立即抛出，避免无意义重试。
   */
  async withRetry<T>(operation: () => Promise<T>, retries = this.options.maxRetries): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await operation();
      } catch (error) {
        const retriable = error instanceof ComfyUiError ? error.retriable : false;
        attempt += 1;
        if (!retriable || attempt > retries) {
          throw error;
        }
        await this.options.sleep(this.backoff(attempt));
      }
    }
  }

  /** 等待任务完成；返回 /history 的真实结构 */
  async waitForCompletion(promptId: string): Promise<PollResult> {
    const startedAt = this.options.now();
    let polls = 0;
    let retries = 0;

    for (;;) {
      const elapsed = this.options.now() - startedAt;
      if (elapsed > this.options.jobTimeoutMs) {
        throw new ComfyUiError({
          kind: 'timeout',
          message: `任务 ${promptId} 轮询超时（${this.options.jobTimeoutMs}ms，已轮询 ${polls} 次）`,
        });
      }

      polls += 1;
      let history: ComfyHistoryEntry | null = null;
      try {
        history = await this.client.getHistory(promptId);
      } catch (error) {
        const retriable = error instanceof ComfyUiError ? error.retriable : false;
        if (!retriable) throw error;
        retries += 1;
        if (retries > this.options.maxRetries) throw error;
        await this.options.sleep(this.backoff(retries));
        continue;
      }

      if (history && history.status?.completed) {
        return {
          history,
          polls,
          retries,
          elapsedMs: this.options.now() - startedAt,
        };
      }

      await this.options.sleep(this.options.pollIntervalMs);
    }
  }
}
