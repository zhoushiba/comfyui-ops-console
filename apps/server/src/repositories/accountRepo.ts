/** 用户 / 代理商 / 定价规则 / 模板的数据访问层 */
import { insertReturningId, type Db } from '../db/knex.js';

export interface UserRow {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  role: string;
  agent_id: number | null;
  status: string;
  created_at: string;
}

export interface AgentRow {
  id: number;
  name: string;
  code: string;
  contact_name: string | null;
  contact_phone: string | null;
  share_ratio: number | string;
  status: string;
  created_at: string;
}

export interface PricingRuleRow {
  id: number;
  agent_id: number;
  model_name: string;
  base_price_cents: number;
  tier_threshold: number;
  tier2_price_cents: number;
  share_ratio: number | string;
  effective_from: string;
  created_at: string;
}

export interface TemplateRow {
  id: number;
  name: string;
  description: string | null;
  model_name: string;
  graph_json: string;
  default_params_json: string | null;
  is_active: boolean | number;
  created_by: number | null;
  created_at: string;
}

export class AccountRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async findUserByEmail(email: string): Promise<UserRow | undefined> {
    return this.db<UserRow>('user').where({ email: email.toLowerCase() }).first();
  }

  async findUserById(id: number): Promise<UserRow | undefined> {
    return this.db<UserRow>('user').where({ id }).first();
  }

  async listUsers(agentId?: number): Promise<UserRow[]> {
    const query = this.db<UserRow>('user').select('*').orderBy('id', 'asc');
    if (agentId) query.where({ agent_id: agentId });
    return query;
  }

  async createUser(data: Record<string, unknown>): Promise<number> {
    return insertReturningId(this.db, 'user', data);
  }

  async listAgents(): Promise<AgentRow[]> {
    return this.db<AgentRow>('agent').orderBy('id', 'asc');
  }

  async findAgentById(id: number): Promise<AgentRow | undefined> {
    return this.db<AgentRow>('agent').where({ id }).first();
  }

  async createAgent(data: Record<string, unknown>): Promise<number> {
    return insertReturningId(this.db, 'agent', data);
  }

  async linkAgentUser(agentId: number, userId: number, joinedAt: string): Promise<number> {
    return insertReturningId(this.db, 'agent_user', { agent_id: agentId, user_id: userId, joined_at: joinedAt });
  }

  async listAgentUsers(agentId: number): Promise<Array<{ user_id: number; name: string; email: string }>> {
    return this.db('agent_user as au')
      .join('user as u', 'u.id', 'au.user_id')
      .select('au.user_id', 'u.name', 'u.email')
      .where('au.agent_id', agentId)
      .orderBy('au.user_id', 'asc');
  }

  async findPricingRule(agentId: number, date: string): Promise<PricingRuleRow | undefined> {
    return this.db<PricingRuleRow>('pricing_rule')
      .where({ agent_id: agentId })
      .andWhere('effective_from', '<=', date)
      .orderBy('effective_from', 'desc')
      .first();
  }

  async listPricingRules(): Promise<PricingRuleRow[]> {
    return this.db<PricingRuleRow>('pricing_rule').orderBy('agent_id', 'asc');
  }

  async createPricingRule(data: Record<string, unknown>): Promise<number> {
    return insertReturningId(this.db, 'pricing_rule', data);
  }

  async listTemplates(activeOnly = true): Promise<TemplateRow[]> {
    const query = this.db<TemplateRow>('prompt_template').orderBy('id', 'asc');
    if (activeOnly) query.where({ is_active: true });
    return query;
  }

  async findTemplateById(id: number): Promise<TemplateRow | undefined> {
    return this.db<TemplateRow>('prompt_template').where({ id }).first();
  }

  async createTemplate(data: Record<string, unknown>): Promise<number> {
    return insertReturningId(this.db, 'prompt_template', data);
  }

  async findAgentUsersMap(): Promise<Map<number, { agentId: number; agentName: string }>> {
    const rows = await this.db('agent_user as au')
      .join('agent as a', 'a.id', 'au.agent_id')
      .select('au.user_id', 'au.agent_id', 'a.name as agent_name');
    const map = new Map<number, { agentId: number; agentName: string }>();
    for (const row of rows as Array<{ user_id: number; agent_id: number; agent_name: string }>) {
      map.set(Number(row.user_id), { agentId: Number(row.agent_id), agentName: row.agent_name });
    }
    return map;
  }
}
