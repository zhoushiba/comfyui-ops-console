/** 鉴权守卫：解析 Bearer 令牌并挂到 request.authUser 上 */
import type { FastifyRequest, preHandlerHookHandler } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import type { AuthService, AuthUser } from '../services/authService.js';

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

export function createAuthGuard(auth: AuthService): preHandlerHookHandler {
  return async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    let token = '';
    if (header && header.startsWith('Bearer ')) {
      token = header.slice('Bearer '.length).trim();
    } else {
      // 图片等由 <img>/<a> 直接访问的地址无法附加请求头，
      // 允许通过 ?token= 传递同一个短期令牌（仅限 GET，且仍会校验签名与过期时间）。
      const query = request.query as { token?: unknown } | undefined;
      if (request.method === 'GET' && typeof query?.token === 'string') {
        token = query.token.trim();
      }
    }
    if (!token) {
      throw new UnauthorizedError('缺少访问令牌，请先登录', 'TOKEN_MISSING');
    }
    request.authUser = await auth.resolveToken(token);
  };
}

export function requireUser(request: FastifyRequest): AuthUser {
  if (!request.authUser) {
    throw new UnauthorizedError('未登录', 'TOKEN_MISSING');
  }
  return request.authUser;
}

export function requireRole(request: FastifyRequest, ...roles: string[]): AuthUser {
  const user = requireUser(request);
  if (roles.length > 0 && !roles.includes(user.role)) {
    throw new ForbiddenError(`需要 ${roles.join('/')} 角色，当前为 ${user.role}`, 'ROLE_FORBIDDEN');
  }
  return user;
}
