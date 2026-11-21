/** 结算单与明细数据访问层（含事务写入） */
import { insertReturningId, type Db } from '../db/knex.js';

export type SettlementStatus = 'pending' | 'confirmed' | 'paid';

export interface SettlementRow {
  id: number;
  settlement_no: string;
  agent_id: number;
  period_start: string;
  period_end: string;
  status: SettlementStatus;
  task_count: number;
  image_count: number;
  gross_cents: number;
  platform_fee_cents: number;
  agent_amount_cents: number;
  confirmed_at: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface SettlementItemRow {
  id: number;
  settlement_id: number;
  usage_record_id: number | null;
  description: string;
  image_count: number;
  unit_price_cents: number;
  amount_cents: number;
  created_at: string;
}

export interface SettlementWithNames extends SettlementRow {
  agent_name?: string;
  agent_code?: string;
}

export class SettlementRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async findByAgentPeriod(agentId: number, periodStart: string, periodEnd: string): Promise<SettlementRow | undefined> {
    return this.db<SettlementRow>('settlement')
      .where({ agent_id: agentId, period_start: periodStart, period_end: periodEnd })
      .first();
  }

  async findById(id: number): Promise<SettlementRow | undefined> {
    return this.db<SettlementRow>('settlement').where({ id }).first();
  }

  async findWithAgent(id: number): Promise<SettlementWithNames | undefined> {
    return this.db('settlement as s')
      .leftJoin('agent as a', 'a.id', 's.agent_id')
      .select('s.*', 'a.name as agent_name', 'a.code as agent_code')
      .where('s.id', id)
      .first() as Promise<SettlementWithNames | undefined>;
  }

  async listItems(settlementId: number): Promise<SettlementItemRow[]> {
    return this.db<SettlementItemRow>('settlement_item')
      .where({ settlement_id: settlementId })
      .orderBy('id', 'asc');
  }

  async list(
    filters: { agentId?: number; status?: string },
    offset: number,
    limit: number,
  ): Promise<SettlementWithNames[]> {
    const query = this.db('settlement as s')
      .leftJoin('agent as a', 'a.id', 's.agent_id')
      .select('s.*', 'a.name as agent_name', 'a.code as agent_code');
    if (filters.agentId) query.where('s.agent_id', filters.agentId);
    if (filters.status) query.where('s.status', filters.status);
    return (await query.orderBy('s.id', 'desc').offset(offset).limit(limit)) as SettlementWithNames[];
  }

  async count(filters: { agentId?: number; status?: string }): Promise<number> {
    const query = this.db('settlement');
    if (filters.agentId) query.where('agent_id', filters.agentId);
    if (filters.status) query.where('status', filters.status);
    const row = await query.count({ total: 'id' }).first();
    return Number(row?.total ?? 0);
  }

  /** 事务写入结算单 + 明细，返回结算单 id */
  async createWithItems(
    settlement: Omit<SettlementRow, 'id' | 'confirmed_at' | 'paid_at'>,
    items: Array<Omit<SettlementItemRow, 'id' | 'settlement_id'>>,
  ): Promise<number> {
    return this.db.transaction(async (trx) => {
      const settlementId = await insertReturningId(trx, 'settlement', settlement);
      if (items.length > 0) {
        await trx('settlement_item').insert(items.map((item) => ({ ...item, settlement_id: settlementId })));
      }
      return settlementId;
    });
  }

  async updateStatus(id: number, status: SettlementStatus, patch: Record<string, unknown> = {}): Promise<void> {
    await this.db('settlement').where({ id }).update({ status, ...patch });
  }
}
