/** 模板路由：出图表单的模板列表 */
import type { FastifyInstance } from 'fastify';
import { ok } from '../http/respond.js';
import type { AppServices } from '../app.js';

export async function templateRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  app.get('/templates', async () => {
    const items = await services.templates.list();
    return ok({ items });
  });
}
