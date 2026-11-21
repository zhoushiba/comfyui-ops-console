/** 认证路由：登录（公开）+ 当前用户 / 登出（受保护） */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../http/auth.js';
import { ok, parseWith } from '../http/respond.js';
import type { AppServices } from '../app.js';

const loginSchema = z.object({
  email: z.string().min(3).max(190),
  password: z.string().min(1).max(200),
});

export async function authPublicRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  app.post('/auth/login', async (request) => {
    const body = parseWith(loginSchema, request.body, '登录参数');
    const result = await services.auth.login(body.email.trim().toLowerCase(), body.password);
    await services.audit.record({
      actorId: result.user.id,
      action: 'auth.login',
      targetType: 'user',
      targetId: String(result.user.id),
      ip: request.ip,
    });
    return ok(result);
  });
}

export async function authRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  app.get('/auth/me', async (request) => {
    const user = requireUser(request);
    return ok({ user });
  });

  app.post('/auth/logout', async (request) => {
    const user = requireUser(request);
    await services.audit.record({
      actorId: user.id,
      action: 'auth.logout',
      targetType: 'user',
      targetId: String(user.id),
      ip: request.ip,
    });
    return ok({ loggedOut: true });
  });
}
