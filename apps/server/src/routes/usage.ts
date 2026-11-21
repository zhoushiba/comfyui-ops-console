/** 用量统计路由（筛选 + 分页明细）与 CSV 流式导出 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../http/auth.js';
import { ok, parsePagination, parseWith } from '../http/respond.js';
import type { AppServices } from '../app.js';
import type { UsageFilters } from '../repositories/usageRepo.js';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD');

const usageQuerySchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  agentId: z.coerce.number().int().positive().optional(),
  userId: z.coerce.number().int().positive().optional(),
  status: z.string().max(24).optional(),
  modelName: z.string().max(120).optional(),
});

function monthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function parseUsageFilters(query: unknown): UsageFilters {
  const parsed = parseWith(usageQuerySchema, query ?? {}, '用量筛选条件');
  return {
    from: parsed.from ?? monthStart(),
    to: parsed.to ?? today(),
    agentId: parsed.agentId,
    userId: parsed.userId,
    status: parsed.status,
    modelName: parsed.modelName,
  };
}

export async function usageRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  app.get('/usage/stats', async (request) => {
    const filters = parseUsageFilters(request.query);
    const stats = await services.usage.stats(filters);
    return ok(stats);
  });

  app.get('/usage/records', async (request) => {
    const filters = parseUsageFilters(request.query);
    const { page, pageSize } = parsePagination(request.query);
    const [items, total] = await Promise.all([
      services.usageRepo.page(filters, (page - 1) * pageSize, pageSize),
      services.usageRepo.count(filters),
    ]);
    return ok({ items, total, page, pageSize });
  });
}

export async function exportRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  app.get('/export/usage.csv', async (request, reply) => {
    const user = requireUser(request);
    const filters = parseUsageFilters(request.query);
    const { filename, contentType, stream, done } = services.exportService.usageCsv(filters, {
      id: user.id,
      ip: request.ip,
    });
    done.catch((error) => app.log.error({ err: error, filename }, '用量 CSV 导出中断'));
    reply.header('Content-Type', contentType);
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('X-Export-Filename', filename);
    return reply.send(stream);
  });

  app.get('/export/settlements.csv', async (request, reply) => {
    const user = requireUser(request);
    const query = (request.query ?? {}) as Record<string, unknown>;
    const filters = {
      agentId: query.agentId ? Number(query.agentId) : undefined,
      status: typeof query.status === 'string' ? query.status : undefined,
    };
    const { filename, contentType, stream, done } = services.exportService.settlementCsv(filters, {
      id: user.id,
      ip: request.ip,
    });
    done.catch((error) => app.log.error({ err: error, filename }, '结算 CSV 导出中断'));
    reply.header('Content-Type', contentType);
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('X-Export-Filename', filename);
    return reply.send(stream);
  });
}
