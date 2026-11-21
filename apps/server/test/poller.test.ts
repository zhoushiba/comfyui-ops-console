/** 轮询器：完成 / 超时 / 错误重试退避 / 不可重试错误直接抛出 */
import { describe, expect, it } from 'vitest';
import { computeBackoff, ComfyUiPoller } from '../src/services/poller.js';
import { ComfyUiError, type ComfyHistoryEntry } from '../src/services/comfyuiClient.js';
import { FakeComfyClient } from './helpers.js';

function historyEntry(): ComfyHistoryEntry {
  return {
    prompt: [1, 'p', {}, {}, ['9']],
    outputs: { '9': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } },
    status: { status_str: 'success', completed: true, messages: [] },
  };
}

describe('computeBackoff', () => {
  it('按 2 的幂增长并封顶', () => {
    expect(computeBackoff(1, 500, 8000)).toBe(500);
    expect(computeBackoff(2, 500, 8000)).toBe(1000);
    expect(computeBackoff(3, 500, 8000)).toBe(2000);
    expect(computeBackoff(10, 500, 8000)).toBe(8000);
  });
});

describe('ComfyUiPoller', () => {
  it('任务完成后返回 history 与轮询次数', async () => {
    const client = new FakeComfyClient({ completeAfterPolls: 2 });
    const poller = new ComfyUiPoller(client.asClient(), {
      pollIntervalMs: 5,
      jobTimeoutMs: 1000,
      maxRetries: 2,
    });
    const result = await poller.waitForCompletion('p-1');
    expect(result.history.status?.completed).toBe(true);
    expect(result.polls).toBe(2);
    expect(result.retries).toBe(0);
  });

  it('超过总超时抛 kind=timeout', async () => {
    const client = new FakeComfyClient({ completeAfterPolls: 9999 });
    const poller = new ComfyUiPoller(client.asClient(), {
      pollIntervalMs: 10,
      jobTimeoutMs: 60,
      maxRetries: 0,
    });
    const error = await poller.waitForCompletion('p-1').catch((err: unknown) => err as ComfyUiError);
    expect(error.kind).toBe('timeout');
    expect(poller.backoff(2)).toBe(1000);
  });

  it('暂时性错误按指数退避重试后成功', async () => {
    const waits: number[] = [];
    let calls = 0;
    const client = {
      async getHistory(): Promise<ComfyHistoryEntry | null> {
        calls += 1;
        if (calls <= 2) {
          throw new ComfyUiError({ kind: 'unreachable', message: '连接中断' });
        }
        return historyEntry();
      },
    };
    const poller = new ComfyUiPoller(client as never, {
      pollIntervalMs: 1,
      jobTimeoutMs: 2000,
      maxRetries: 3,
      backoffBaseMs: 10,
      backoffMaxMs: 100,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    const result = await poller.waitForCompletion('p-1');
    expect(result.retries).toBe(2);
    expect(waits.slice(0, 2)).toEqual([10, 20]);
    expect(result.history.status?.completed).toBe(true);
  });

  it('400 这类不可重试错误立即抛出，不做退避', async () => {
    let calls = 0;
    const client = {
      async getHistory(): Promise<ComfyHistoryEntry | null> {
        calls += 1;
        throw new ComfyUiError({ kind: 'http', status: 400, message: 'bad request' });
      },
    };
    const poller = new ComfyUiPoller(client as never, {
      pollIntervalMs: 1,
      jobTimeoutMs: 1000,
      maxRetries: 5,
      sleep: async () => undefined,
    });
    const error = await poller.waitForCompletion('p-1').catch((err: unknown) => err as ComfyUiError);
    expect(error.status).toBe(400);
    expect(calls).toBe(1);
  });

  it('withRetry 在超过重试上限后抛出最后一个错误', async () => {
    let calls = 0;
    const poller = new ComfyUiPoller(new FakeComfyClient().asClient(), {
      pollIntervalMs: 1,
      jobTimeoutMs: 1000,
      maxRetries: 2,
      backoffBaseMs: 1,
      sleep: async () => undefined,
    });
    const error = await poller
      .withRetry(async () => {
        calls += 1;
        throw new ComfyUiError({ kind: 'timeout', message: '超时' });
      })
      .catch((err: unknown) => err as ComfyUiError);
    expect(error.kind).toBe('timeout');
    expect(calls).toBe(3);
  });
});
