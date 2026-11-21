/**
 * 轻量 HMAC-SHA256 令牌（不引入 jsonwebtoken）。
 * 结构： base64url(payload).base64url(signature)
 * payload: { sub, role, agentId, exp }
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { UnauthorizedError } from './errors.js';

export interface TokenPayload {
  sub: number;
  email: string;
  role: string;
  agentId: number | null;
  exp: number;
}

function sign(input: string, secret: string): string {
  return createHmac('sha256', secret).update(input).digest('base64url');
}

export function createToken(
  payload: Omit<TokenPayload, 'exp'>,
  secret: string,
  ttlSeconds: number,
): { token: string; expiresAt: string } {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = Buffer.from(JSON.stringify({ ...payload, exp }), 'utf8').toString('base64url');
  const signature = sign(body, secret);
  return {
    token: `${body}.${signature}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export function verifyToken(token: string, secret: string): TokenPayload {
  const [body, signature] = token.split('.');
  if (!body || !signature) {
    throw new UnauthorizedError('令牌格式不正确', 'TOKEN_MALFORMED');
  }

  const expected = Buffer.from(sign(body, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new UnauthorizedError('令牌签名校验失败', 'TOKEN_INVALID');
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
  } catch {
    throw new UnauthorizedError('令牌内容无法解析', 'TOKEN_INVALID');
  }

  if (!payload.exp || payload.exp * 1000 < Date.now()) {
    throw new UnauthorizedError('登录已过期，请重新登录', 'TOKEN_EXPIRED');
  }
  return payload;
}
