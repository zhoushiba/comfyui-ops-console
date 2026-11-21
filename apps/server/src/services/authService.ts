/** 登录鉴权：scrypt 校验 + HMAC 令牌 + 用户 DTO */
import { UnauthorizedError } from '../lib/errors.js';
import { verifyPassword } from '../lib/password.js';
import { createToken, verifyToken } from '../lib/token.js';
import type { AppConfig } from '../config.js';
import type { AccountRepository, UserRow } from '../repositories/accountRepo.js';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
  agentId: number | null;
  agentName: string | null;
}

export interface LoginResult {
  token: string;
  expiresAt: string;
  user: AuthUser;
}

export class AuthService {
  private readonly accounts: AccountRepository;
  private readonly config: AppConfig;

  constructor(accounts: AccountRepository, config: AppConfig) {
    this.accounts = accounts;
    this.config = config;
  }

  private async toDto(user: UserRow): Promise<AuthUser> {
    let agentName: string | null = null;
    if (user.agent_id) {
      const agent = await this.accounts.findAgentById(user.agent_id);
      agentName = agent?.name ?? null;
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      agentId: user.agent_id ?? null,
      agentName,
    };
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.accounts.findUserByEmail(email);
    // 用户不存在与密码错误返回同一错误，避免账号枚举
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new UnauthorizedError('邮箱或密码不正确', 'LOGIN_FAILED');
    }
    if (user.status !== 'active') {
      throw new UnauthorizedError('账号已被禁用', 'ACCOUNT_DISABLED');
    }

    const { token, expiresAt } = createToken(
      { sub: user.id, email: user.email, role: user.role, agentId: user.agent_id ?? null },
      this.config.tokenSecret,
      this.config.tokenTtlSeconds,
    );
    return { token, expiresAt, user: await this.toDto(user) };
  }

  async resolveToken(token: string): Promise<AuthUser> {
    const payload = verifyToken(token, this.config.tokenSecret);
    const user = await this.accounts.findUserById(payload.sub);
    if (!user || user.status !== 'active') {
      throw new UnauthorizedError('用户不存在或已禁用', 'ACCOUNT_DISABLED');
    }
    return this.toDto(user);
  }
}
