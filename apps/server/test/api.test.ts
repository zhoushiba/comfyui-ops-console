/** HTTP 层集成测试：登录、鉴权、幂等提交、完成链路、用量、CSV 导出、unreachable */
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestApp } from './helpers.js';
import { FakeComfyClient, createTestApp, solidPng, authHeader } from './helpers.js';
import { ComfyUiError } from '../src/services/comfyuiClient.js';

interface ApiBody<T> {
  success: boolean;
  data: T;
}

let ctx: TestApp;
let token: string;

async function createTask(client: TestApp, requestId?: string): Promise<{ id: number; created: boolean }> {
  const response = await client.app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: authHeader(token),
    payload: { templateId: 1, prompt: '一座云海上的漂浮城市，电影感光线', batchSize: 1, clientRequestId: requestId },
  });
  expect(response.statusCode).toBeLessThan(300);
  const body = response.json() as ApiBody<{ task: { id: number }; created: boolean }>;
  return { id: body.data.task.id, created: body.data.created };
}

beforeAll(async () => {
  const fake = new FakeComfyClient({ downloadBuffer: await solidPng(160, 120) });
  ctx = await createTestApp({ client: fake });
  token = await ctx.login();
});

afterAll(async () => {
  await ctx.close();
});

describe('认证与鉴权', () => {
  it('登录成功返回 HMAC 令牌与用户信息', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@ops.local', password: 'Admin@123456' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as ApiBody<{ token: string; user: { role: string; name: string } }>;
    expect(body.success).toBe(true);
    expect(body.data.token.split('.')).toHaveLength(2);
    expect(body.data.user.role).toBe('admin');
  });

  it('密码错误返回 401 且不泄露账号是否存在', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@ops.local', password: 'wrong-password' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ success: false, error: { code: 'LOGIN_FAILED' } });
  });

  it('未携带令牌访问受保护接口返回 401', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/tasks' });
    expect(response.statusCode).toBe(401);
  });

  it('GET /auth/me 返回当前用户', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: authHeader(token) });
    expect(response.statusCode).toBe(200);
    expect((response.json() as ApiBody<{ user: { email: string } }>).data.user.email).toBe('admin@ops.local');
  });
});

describe('任务提交与幂等', () => {
  it('clientRequestId 相同的重复提交只创建一个任务', async () => {
    const first = await createTask(ctx, 'idem-key-001');
    const second = await createTask(ctx, 'idem-key-001');
    expect(second.id).toBe(first.id);
    expect(second.created).toBe(false);
  });

  it('参数非法（steps 超范围）返回 400 VALIDATION_ERROR', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: authHeader(token),
      payload: { templateId: 1, prompt: '测试', steps: 999 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
  });
});

describe('端到端执行链路（进程内）', () => {
  it('提交后经轮询、下载完成，图片真实落盘且为 PNG', async () => {
    const { id } = await createTask(ctx, 'e2e-complete-001');
    await ctx.services.orchestrator.waitFor(id, 20000);

    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/api/tasks/${id}`,
      headers: authHeader(token),
    });
    const body = detail.json() as ApiBody<{
      task: { status: string; progress: number; imageCount: number; attempts: number };
      images: Array<{ id: number; format: string; url: string }>;
      attempts: Array<{ status: string }>;
    }>;
    expect(body.data.task.status).toBe('completed');
    expect(body.data.task.progress).toBe(100);
    expect(body.data.task.imageCount).toBe(1);
    expect(body.data.task.attempts).toBe(1);
    expect(body.data.images).toHaveLength(1);
    expect(body.data.attempts).toHaveLength(1);

    const rows = await ctx.services.imagesRepo.listByTask(id);
    expect(rows).toHaveLength(1);
    const absolute = ctx.services.storage.abs(rows[0].storage_path);
    expect(existsSync(absolute)).toBe(true);
    const file = await ctx.services.storage.read(rows[0].storage_path);
    expect(file.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(rows[0].width).toBe(160);
    expect(rows[0].height).toBe(120);

    const download = await ctx.app.inject({
      method: 'GET',
      url: `/api/images/${rows[0].id}/download`,
      headers: authHeader(token),
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toContain('image/png');
    expect(download.headers['content-disposition']).toContain('attachment');
  });
});

describe('用量统计与 CSV 导出', () => {
  it('用量统计包含成功率、P50/P95 与代理商维度', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/usage/stats',
      headers: authHeader(token),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as ApiBody<{
      totals: { tasks: number; images: number };
      successRate: number;
      p50DurationMs: number;
      p95DurationMs: number;
      byAgent: unknown[];
    }>;
    expect(body.data.totals.tasks).toBeGreaterThan(0);
    expect(body.data.totals.images).toBeGreaterThan(0);
    expect(body.data.p95DurationMs).toBeGreaterThanOrEqual(body.data.p50DurationMs);
    expect(Array.isArray(body.data.byAgent)).toBe(true);
  });

  it('用量 CSV 首 3 字节为 EF BB BF，中文表头且行数与数据一致', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/export/usage.csv',
      headers: authHeader(token),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(String(response.headers['x-export-filename'])).toMatch(/^usage-\d{8}-\d{6}\.csv$/);

    const raw = Buffer.from(response.rawPayload);
    expect([...raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = raw.toString('utf8').replace(/^\uFEFF/, '');
    const lines = text.split('\r\n').filter((line) => line.length > 0);
    expect(lines[0]).toBe('任务编号,用户名,代理商,模型,状态,图片数,耗时(毫秒),GPU秒,是否计费,发生日期');
    expect(lines.length).toBeGreaterThan(1);
  });
});

describe('ComfyUI 连接被拒绝', () => {
  let brokenCtx: TestApp;

  beforeAll(async () => {
    brokenCtx = await createTestApp({
      client: new FakeComfyClient({
        submitError: new ComfyUiError({ kind: 'unreachable', message: '无法连接 ComfyUI' }),
      }),
      config: { comfyuiMaxRetries: 0 },
    });
  });

  afterAll(async () => {
    await brokenCtx.close();
  });

  it('Mock 未启动时任务最终变为 unreachable，并记录错误码', async () => {
    const brokenToken = await brokenCtx.login();
    const created = await brokenCtx.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: authHeader(brokenToken),
      payload: { templateId: 1, prompt: '服务未启动时提交' },
    });
    expect(created.statusCode).toBe(201);
    const taskId = (created.json() as ApiBody<{ task: { id: number } }>).data.task.id;
    await brokenCtx.services.orchestrator.waitFor(taskId, 15000);

    const detail = await brokenCtx.app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}`,
      headers: authHeader(brokenToken),
    });
    const body = detail.json() as ApiBody<{
      task: { status: string; errorCode: string; errorMessage: string };
    }>;
    expect(body.data.task.status).toBe('unreachable');
    expect(body.data.task.errorCode).toBe('COMFYUI_UNREACHABLE');
    expect(body.data.task.errorMessage).toContain('无法连接 ComfyUI');
  });
});
