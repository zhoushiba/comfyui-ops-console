/** 代理商与结算路由 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../http/auth.js';
import { ok, parseId, parsePagination, parseWith } from '../http/respond.js';
import type { AppServices } from '../app.js';

const periodSchema = z.object({
  agentId: z.coerce.number().int().positive(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const createSettlementSchema = z.object({
  agentId: z.coerce.number().int().positive(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function agentRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  app.get('/agents', async () => {
    const items = await services.settlements.agentOverview();
    return ok({ items });
  });

  app.get('/agents/:id', async (request) => {
    const id = parseId((request.params as { id?: string }).id, '代理商 ID');
    const detail = await services.settlements.agentDetail(id);
    return ok(detail);
  });

  app.get('/agents/:id/settlement-preview', async (request) => {
    const id = parseId((request.params as { id?: string }).id, '代理商 ID');
    const query = parseWith(
      periodSchema.omit({ agentId: true }),
      request.query ?? {},
      '账期参数',
    );
    const preview = await services.settlements.preview(id, query.from, query.to);
    return ok(preview);
  });
}

export async function settlementRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  app.get('/settlements', async (request) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const { page, pageSize } = parsePagination(query);
    const filters = {
      agentId: query.agentId ? Number(query.agentId) : undefined,
      status: typeof query.status === 'string' ? query.status : undefined,
    };
    const result = await services.settlements.list(filters, page, pageSize);
    return ok({ ...result, page, pageSize });
  });

  app.post('/settlements', async (request, reply) => {
    const user = requireUser(request);
    const body = parseWith(createSettlementSchema, request.body, '结算参数');
    const result = await services.settlements.create(body.agentId, body.periodStart, body.periodEnd);
    await services.audit.record({
      actorId: user.id,
      action: 'settlement.create',
      targetType: 'settlement',
      targetId: String(result.id),
      detail: { ...body, settlementNo: result.settlementNo },
      ip: request.ip,
    });
    reply.code(201);
    return ok(result);
  });

  app.get('/settlements/:id', async (request) => {
    const id = parseId((request.params as { id?: string }).id, '结算单 ID');
    return ok(await services.settlements.detail(id));
  });

  app.post('/settlements/:id/confirm', async (request) => {
    const user = requireUser(request);
    const id = parseId((request.params as { id?: string }).id, '结算单 ID');
    const settlement = await services.settlements.updateStatus(id, 'confirmed');
    await services.audit.record({
      actorId: user.id,
      action: 'settlement.confirm',
      targetType: 'settlement',
      targetId: String(id),
      ip: request.ip,
    });
    return ok({ settlement });
  });

  app.post('/settlements/:id/pay', async (request) => {
    const user = requireUser(request);
    const id = parseId((request.params as { id?: string }).id, '结算单 ID');
    const settlement = await services.settlements.updateStatus(id, 'paid');
    await services.audit.record({
      actorId: user.id,
      action: 'settlement.pay',
      targetType: 'settlement',
      targetId: String(id),
      ip: request.ip,
    });
    return ok({ settlement });
  });
}
