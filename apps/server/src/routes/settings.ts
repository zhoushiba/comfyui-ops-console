/** 设置路由：读取/更新 ComfyUI 地址与编排参数，连接测试 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole, requireUser } from '../http/auth.js';
import { ok, parseWith } from '../http/respond.js';
import type { AppServices } from '../app.js';

const SETTING_KEYS = [
  'comfyuiBaseUrl',
  'comfyuiRequestTimeoutMs',
  'comfyuiPollIntervalMs',
  'comfyuiJobTimeoutMs',
  'orchestratorConcurrency',
  'thumbnailSize',
] as const;

type SettingKey = (typeof SETTING_KEYS)[number];

const updateSettingsSchema = z
  .object({
    comfyuiBaseUrl: z.string().url('必须是合法 URL').max(300).optional(),
    comfyuiRequestTimeoutMs: z.coerce.number().int().min(1000).max(120_000).optional(),
    comfyuiPollIntervalMs: z.coerce.number().int().min(200).max(10_000).optional(),
    comfyuiJobTimeoutMs: z.coerce.number().int().min(5_000).max(3_600_000).optional(),
    orchestratorConcurrency: z.coerce.number().int().min(1).max(8).optional(),
    thumbnailSize: z.coerce.number().int().min(64).max(512).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '至少提供一个设置项' });

function snapshot(services: AppServices): Record<SettingKey, string | number> {
  return {
    comfyuiBaseUrl: services.config.comfyuiBaseUrl,
    comfyuiRequestTimeoutMs: services.config.comfyuiRequestTimeoutMs,
    comfyuiPollIntervalMs: services.config.comfyuiPollIntervalMs,
    comfyuiJobTimeoutMs: services.config.comfyuiJobTimeoutMs,
    orchestratorConcurrency: services.config.orchestratorConcurrency,
    thumbnailSize: services.config.thumbnailSize,
  };
}

export async function settingsRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  app.get('/settings', async () => {
    return ok({
      settings: snapshot(services),
      storageDir: services.config.storageDir,
      dbClient: services.config.dbClient,
      version: '1.0.0',
    });
  });

  app.put('/settings', async (request) => {
    const user = requireUser(request);
    requireRole(request, 'admin');
    const patch = parseWith(updateSettingsSchema, request.body, '设置项');

    for (const key of SETTING_KEYS) {
      const value = patch[key];
      if (value === undefined) continue;
      if (key === 'comfyuiBaseUrl') {
        services.config.comfyuiBaseUrl = String(value);
      } else if (key === 'comfyuiRequestTimeoutMs') {
        services.config.comfyuiRequestTimeoutMs = Number(value);
      } else if (key === 'comfyuiPollIntervalMs') {
        services.config.comfyuiPollIntervalMs = Number(value);
      } else if (key === 'comfyuiJobTimeoutMs') {
        services.config.comfyuiJobTimeoutMs = Number(value);
      } else if (key === 'orchestratorConcurrency') {
        services.config.orchestratorConcurrency = Number(value);
      } else if (key === 'thumbnailSize') {
        services.config.thumbnailSize = Number(value);
      }
    }
    // 客户端与轮询器共享同一 config 引用，地址变更立即生效
    services.client.setEndpoint(services.config.comfyuiBaseUrl, services.config.comfyuiRequestTimeoutMs);
    services.poller.configure({
      pollIntervalMs: services.config.comfyuiPollIntervalMs,
      jobTimeoutMs: services.config.comfyuiJobTimeoutMs,
      maxRetries: services.config.comfyuiMaxRetries,
    });
    await services.configRepo.setMany(
      Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, String(value)])),
    );
    await services.audit.record({
      actorId: user.id,
      action: 'settings.update',
      targetType: 'system_config',
      detail: patch,
      ip: request.ip,
    });
    return ok({ settings: snapshot(services) });
  });

  app.post('/settings/test', async () => {
    const startedAt = Date.now();
    try {
      const stats = await services.client.getSystemStats();
      const system = (stats.system ?? {}) as Record<string, unknown>;
      const devices = Array.isArray(stats.devices) ? stats.devices : [];
      return ok({
        reachable: true,
        latencyMs: Date.now() - startedAt,
        version: String(system.comfyui_version ?? 'unknown'),
        pythonVersion: system.python_version ? String(system.python_version) : null,
        devices: devices.map((device) => {
          const row = device as Record<string, unknown>;
          return { name: String(row.name ?? ''), type: String(row.type ?? ''), vramTotal: row.vram_total ?? null };
        }),
      });
    } catch (error) {
      const typed = error as { kind?: string; message?: string; status?: number };
      return ok({
        reachable: false,
        latencyMs: Date.now() - startedAt,
        errorKind: typed.kind ?? 'unknown',
        status: typed.status ?? null,
        message: typed.message ?? '连接失败',
      });
    }
  });
}
