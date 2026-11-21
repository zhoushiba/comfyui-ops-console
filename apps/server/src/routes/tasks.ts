/** 任务路由：创建（幂等）、列表、详情、重试 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../http/auth.js';
import { toImageDto, toTaskDto } from '../http/dto.js';
import { ok, parseId, parsePagination, parseWith } from '../http/respond.js';
import type { AppServices } from '../app.js';

const createTaskSchema = z.object({
  templateId: z.coerce.number().int().positive(),
  prompt: z.string().min(1, '提示词不能为空').max(2000),
  negativePrompt: z.string().max(2000).optional(),
  seed: z.coerce.number().int().min(0).max(2_147_483_647).optional(),
  steps: z.coerce.number().int().min(1).max(150).optional(),
  cfg: z.coerce.number().min(0).max(30).optional(),
  width: z.coerce.number().int().min(64).max(2048).optional(),
  height: z.coerce.number().int().min(64).max(2048).optional(),
  batchSize: z.coerce.number().int().min(1).max(8).optional(),
  clientRequestId: z.string().min(1).max(80).optional(),
});

const taskQuerySchema = z.object({
  status: z.enum(['queued', 'submitted', 'running', 'polling', 'downloading', 'completed', 'failed', 'timeout', 'unreachable']).optional(),
  keyword: z.string().max(200).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  userId: z.coerce.number().int().positive().optional(),
  agentId: z.coerce.number().int().positive().optional(),
});

export async function taskRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  app.post('/tasks', async (request, reply) => {
    const user = requireUser(request);
    const body = parseWith(createTaskSchema, request.body, '出图参数');
    const { task, created } = await services.tasks.create(user, body);
    reply.code(created ? 201 : 200);
    return ok({ task: toTaskDto(task), created });
  });

  app.get('/tasks', async (request) => {
    const filters = parseWith(taskQuerySchema, request.query ?? {}, '查询条件');
    const { page, pageSize } = parsePagination(request.query);
    const result = await services.tasks.list(filters, page, pageSize);
    return ok({
      ...result,
      items: (result.items as Parameters<typeof toTaskDto>[0][]).map(toTaskDto),
    });
  });

  app.get('/tasks/:id', async (request) => {
    const id = parseId((request.params as { id?: string }).id, '任务 ID');
    const detail = await services.tasks.detail(id);
    return ok({
      task: toTaskDto(detail.task),
      templateName: detail.templateName,
      images: detail.images.map(toImageDto),
      attempts: detail.attempts,
    });
  });

  app.post('/tasks/:id/retry', async (request) => {
    const id = parseId((request.params as { id?: string }).id, '任务 ID');
    const task = await services.tasks.retry(id);
    return ok({ task: toTaskDto(task) });
  });
}
