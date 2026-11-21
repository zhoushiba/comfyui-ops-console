/** 系统状态与审计日志：给前端顶部健康指示器与设置页用 */
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../http/auth.js';
import { ok } from '../http/respond.js';
import type { AppServices } from '../app.js';

export async function systemRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  app.get('/system/status', async () => {
    const startedAt = Date.now();
    let dbOk = true;
    try {
      await services.db.raw('select 1');
    } catch {
      dbOk = false;
    }

    let comfyui: Record<string, unknown> = { reachable: false };
    try {
      const stats = await services.client.getSystemStats();
      const system = (stats.system ?? {}) as Record<string, unknown>;
      comfyui = {
        reachable: true,
        latencyMs: Date.now() - startedAt,
        version: String(system.comfyui_version ?? 'unknown'),
        devices: Array.isArray(stats.devices) ? stats.devices.length : 0,
      };
    } catch (error) {
      const typed = error as { kind?: string; message?: string };
      comfyui = {
        reachable: false,
        latencyMs: Date.now() - startedAt,
        errorKind: typed.kind ?? 'unknown',
        message: typed.message ?? '连接失败',
      };
    }

    return ok({
      db: dbOk ? 'ok' : 'error',
      comfyui,
      orchestrator: services.orchestrator.stats,
      queue: await services.client.getQueue().catch(() => null),
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      generatedAt: new Date().toISOString(),
    });
  });

  app.get('/system/audit-logs', async (request) => {
    requireUser(request);
    const limit = Math.min(Number((request.query as { limit?: string })?.limit ?? 50), 200);
    const items = await services.audit.list(Number.isFinite(limit) ? limit : 50);
    return ok({ items });
  });

  app.get('/system/summary', async () => {
    const [tasks, images, agents] = await Promise.all([
      services.tasksRepo.list({}, 1, 5),
      services.imagesRepo.countAll(),
      services.accounts.listAgents(),
    ]);
    return ok({
      taskTotal: tasks.total,
      imageTotal: images,
      agentTotal: agents.length,
      recent: tasks.items.map((task) => ({
        id: task.id,
        taskNo: task.task_no,
        status: task.status,
        createdAt: task.created_at,
      })),
    });
  });
}
