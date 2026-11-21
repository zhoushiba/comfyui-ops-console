/** 测试夹具：临时 SQLite + 假 ComfyUI 客户端 + 登录辅助 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { createApp, type AppServices } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { seedDatabase } from '../src/db/seed.js';
import { ComfyUiError } from '../src/services/comfyuiClient.js';
import type {
  ComfyHistoryEntry,
  ComfyHistoryImage,
  ComfyPromptResponse,
  ComfyUiClient,
} from '../src/services/comfyuiClient.js';

export async function solidPng(width = 96, height = 96, color = { r: 40, g: 90, b: 200 }): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}

export interface FakeComfyOptions {
  /** submitPrompt 抛出的错误（用于 unreachable / 400 场景） */
  submitError?: ComfyUiError;
  /** 第几次查询 history 才返回完成，默认 1 */
  completeAfterPolls?: number;
  images?: ComfyHistoryImage[];
  downloadBuffer?: Buffer;
  downloadError?: ComfyUiError;
  /** history 查询抛错（模拟轮询中的网络错误） */
  historyError?: ComfyUiError;
}

export class FakeComfyClient {
  readonly calls = { submit: 0, history: 0, download: 0 };
  private readonly options: FakeComfyOptions;
  lastClientId: string | null = null;

  constructor(options: FakeComfyOptions = {}) {
    this.options = options;
  }

  async submitPrompt(_graph: Record<string, unknown>, clientId: string): Promise<ComfyPromptResponse> {
    this.calls.submit += 1;
    this.lastClientId = clientId;
    if (this.options.submitError) throw this.options.submitError;
    return { promptId: `fake-${this.calls.submit}`, number: this.calls.submit, nodeErrors: {} };
  }

  async getHistory(promptId: string): Promise<ComfyHistoryEntry | null> {
    this.calls.history += 1;
    if (this.options.historyError) throw this.options.historyError;
    const after = this.options.completeAfterPolls ?? 1;
    if (this.calls.history < after) return null;
    return {
      prompt: [1, promptId, {}, {}, ['9']],
      outputs: {
        '9': {
          images: this.options.images ?? [{ filename: 'ComfyUI_0001.png', subfolder: '', type: 'output' }],
        },
      },
      status: { status_str: 'success', completed: true, messages: [] },
    };
  }

  async downloadImage(_image: ComfyHistoryImage): Promise<{ buffer: Buffer; contentType: string }> {
    this.calls.download += 1;
    if (this.options.downloadError) throw this.options.downloadError;
    const buffer = this.options.downloadBuffer ?? (await solidPng());
    return { buffer, contentType: 'image/png' };
  }

  async getQueue(): Promise<unknown> {
    return { queue_running: [], queue_pending: [] };
  }

  async getSystemStats(): Promise<Record<string, unknown>> {
    return {
      system: { comfyui_version: '0.3.68-fake', python_version: '3.11' },
      devices: [{ name: 'fake-gpu', type: 'cuda', vram_total: 1024 }],
    };
  }

  asClient(): ComfyUiClient {
    return this as unknown as ComfyUiClient;
  }
}

export interface TestApp {
  app: FastifyInstance;
  services: AppServices;
  dir: string;
  close: () => Promise<void>;
  login: (email?: string, password?: string) => Promise<string>;
}

export async function createTestApp(options: {
  client?: FakeComfyClient;
  config?: Partial<AppConfig>;
} = {}): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'comfyui-ops-test-'));
  const created = await createApp({
    config: {
      dbClient: 'sqlite',
      dbFilename: join(dir, 'test.db'),
      storageDir: join(dir, 'storage'),
      tokenSecret: 'test-secret-key',
      comfyuiPollIntervalMs: 10,
      comfyuiRequestTimeoutMs: 1500,
      comfyuiJobTimeoutMs: 8000,
      comfyuiMaxRetries: 2,
      orchestratorConcurrency: 2,
      logLevel: 'silent',
      ...options.config,
    },
    client: options.client?.asClient(),
    logger: false,
  });
  await seedDatabase(created.services.db);

  const login = async (email = 'admin@ops.local', password = 'Admin@123456'): Promise<string> => {
    const response = await created.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password },
    });
    const body = response.json() as { data?: { token?: string } };
    if (!body.data?.token) throw new Error(`登录失败：${response.body}`);
    return body.data.token;
  };

  return {
    ...created,
    dir,
    login,
    close: async () => {
      await created.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
