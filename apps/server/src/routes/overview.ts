/** 总览看板路由 */
import type { FastifyInstance } from 'fastify';
import { ok } from '../http/respond.js';
import type { AppServices } from '../app.js';

export async function overviewRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  app.get('/overview', async () => {
    const data = await services.overview.build(services.orchestrator.stats);
    return ok(data);
  });
}
