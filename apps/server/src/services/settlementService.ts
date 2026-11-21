/**
 * 代理商结算：按账期从 usage_record 取"成功且计费"的用量，
 * 用定价规则做阶梯计价，生成结算单与逐条明细。
 *
 * 阶梯是"累计式"的：按记录顺序累计图片数，前 threshold 张走单价一，
 * 超出部分走单价二；一条记录跨越档位时拆成两条明细，保证明细合计 == 结算总额。
 */
import { ConflictError, NotFoundError, UnprocessableError } from '../lib/errors.js';
import { nowIso, type Db } from '../db/knex.js';
import { settlementNo } from '../lib/utils.js';
import {
  calculateSettlementAmount,
  validatePricingRule,
  type PricingRuleInput,
  type SettlementAmount,
} from './settlementCalculator.js';
import type { AccountRepository } from '../repositories/accountRepo.js';
import type { SettlementRepository, SettlementRow, SettlementStatus } from '../repositories/settlementRepo.js';
import type { UsageRepository, UsageRow } from '../repositories/usageRepo.js';

export interface SettlementItemDraft {
  usageRecordId: number;
  description: string;
  imageCount: number;
  unitPriceCents: number;
  amountCents: number;
}

export interface SettlementPreview {
  agentId: number;
  agentName: string;
  periodStart: string;
  periodEnd: string;
  taskCount: number;
  imageCount: number;
  userCount: number;
  rule: PricingRuleInput & { id: number; modelName: string; effectiveFrom: string };
  amount: SettlementAmount;
  users: Array<{ userId: number; userName: string; tasks: number; images: number }>;
  items: SettlementItemDraft[];
  existingSettlementId: number | null;
}

/** 把用量记录按阶梯单价拆成明细（纯函数，便于单测） */
export function allocateItems(
  records: Array<Pick<UsageRow, 'id' | 'image_count'> & { task_no?: string; user_name?: string }>,
  rule: PricingRuleInput,
): SettlementItemDraft[] {
  validatePricingRule(rule);
  const items: SettlementItemDraft[] = [];
  let cumulative = 0;

  for (const record of records) {
    let remaining = Math.max(0, Math.floor(record.image_count));
    if (remaining === 0) continue;

    while (remaining > 0) {
      const inTier1 = cumulative < rule.tierThreshold;
      const take = inTier1
        ? Math.min(remaining, Math.max(1, rule.tierThreshold - cumulative))
        : remaining;
      const unitPriceCents = inTier1 ? rule.basePriceCents : rule.tier2PriceCents;
      const label = inTier1 ? '阶梯一' : '阶梯二';
      items.push({
        usageRecordId: record.id,
        description: `${label} · 任务 ${record.task_no ?? `#${record.id}`} · ${record.user_name ?? '用户'} · ${take} 张`,
        imageCount: take,
        unitPriceCents,
        amountCents: take * unitPriceCents,
      });
      cumulative += take;
      remaining -= take;
    }
  }

  return items;
}

export class SettlementService {
  private readonly db: Db;
  private readonly accounts: AccountRepository;
  private readonly usage: UsageRepository;
  private readonly settlements: SettlementRepository;

  constructor(db: Db, accounts: AccountRepository, usage: UsageRepository, settlements: SettlementRepository) {
    this.db = db;
    this.accounts = accounts;
    this.usage = usage;
    this.settlements = settlements;
  }

  async preview(agentId: number, periodStart: string, periodEnd: string): Promise<SettlementPreview> {
    if (periodStart > periodEnd) {
      throw new UnprocessableError('账期开始日期不能晚于结束日期', 'INVALID_PERIOD');
    }
    const agent = await this.accounts.findAgentById(agentId);
    if (!agent) throw new NotFoundError(`代理商 #${agentId} 不存在`);

    const ruleRow = await this.accounts.findPricingRule(agentId, periodEnd);
    if (!ruleRow) {
      throw new UnprocessableError(`代理商「${agent.name}」未配置定价规则，请先在设置中配置`, 'NO_PRICING_RULE');
    }

    const rule: SettlementPreview['rule'] = {
      id: ruleRow.id,
      modelName: ruleRow.model_name,
      effectiveFrom: ruleRow.effective_from,
      basePriceCents: Number(ruleRow.base_price_cents),
      tierThreshold: Number(ruleRow.tier_threshold),
      tier2PriceCents: Number(ruleRow.tier2_price_cents),
      shareRatio: Number(ruleRow.share_ratio),
    };
    validatePricingRule(rule);

    const records = await this.usage.settlementSource(agentId, periodStart, periodEnd);
    const imageCount = records.reduce((sum, record) => sum + Number(record.image_count), 0);
    const items = allocateItems(records, rule);
    const amount = calculateSettlementAmount(imageCount, rule);
    const users = await this.usage.byUser({
      agentId,
      from: periodStart,
      to: periodEnd,
      status: 'completed',
    });
    const existing = await this.settlements.findByAgentPeriod(agentId, periodStart, periodEnd);

    return {
      agentId,
      agentName: agent.name,
      periodStart,
      periodEnd,
      taskCount: records.length,
      imageCount,
      userCount: users.length,
      rule,
      amount,
      users,
      items,
      existingSettlementId: existing?.id ?? null,
    };
  }

  async create(agentId: number, periodStart: string, periodEnd: string): Promise<{ id: number; settlementNo: string }> {
    const preview = await this.preview(agentId, periodStart, periodEnd);
    if (preview.existingSettlementId) {
      throw new ConflictError(
        `账期 ${periodStart}~${periodEnd} 已存在结算单 #${preview.existingSettlementId}`,
        'SETTLEMENT_EXISTS',
      );
    }
    if (preview.imageCount === 0) {
      throw new UnprocessableError('该账期没有可结算的计费用量', 'NOTHING_TO_SETTLE');
    }

    const no = settlementNo(agentId, periodStart, periodEnd);
    const createdAt = nowIso();
    const id = await this.settlements.createWithItems(
      {
        settlement_no: no,
        agent_id: agentId,
        period_start: periodStart,
        period_end: periodEnd,
        status: 'pending',
        task_count: preview.taskCount,
        image_count: preview.imageCount,
        gross_cents: preview.amount.grossCents,
        platform_fee_cents: preview.amount.platformFeeCents,
        agent_amount_cents: preview.amount.agentAmountCents,
        created_at: createdAt,
      },
      preview.items.map((item) => ({
        usage_record_id: item.usageRecordId,
        description: item.description,
        image_count: item.imageCount,
        unit_price_cents: item.unitPriceCents,
        amount_cents: item.amountCents,
        created_at: createdAt,
      })),
    );
    return { id, settlementNo: no };
  }

  async list(
    filters: { agentId?: number; status?: string },
    page: number,
    pageSize: number,
  ): Promise<{ items: Array<SettlementRow & { agent_name?: string; agent_code?: string }>; total: number }> {
    const [items, total] = await Promise.all([
      this.settlements.list(filters, (page - 1) * pageSize, pageSize),
      this.settlements.count(filters),
    ]);
    return { items, total };
  }

  async detail(id: number): Promise<{
    settlement: SettlementRow & { agent_name?: string; agent_code?: string };
    items: unknown[];
  }> {
    const settlement = await this.settlements.findWithAgent(id);
    if (!settlement) throw new NotFoundError(`结算单 #${id} 不存在`);
    const items = await this.settlements.listItems(id);
    return { settlement, items };
  }

  /** 状态流转：pending→confirmed→paid，允许幂等重复调用同状态 */
  async updateStatus(id: number, status: SettlementStatus): Promise<SettlementRow> {
    const settlement = await this.settlements.findById(id);
    if (!settlement) throw new NotFoundError(`结算单 #${id} 不存在`);

    const order: SettlementStatus[] = ['pending', 'confirmed', 'paid'];
    const current = order.indexOf(settlement.status);
    const next = order.indexOf(status);
    if (next < current) {
      throw new ConflictError(`结算单状态不能从 ${settlement.status} 回退到 ${status}`, 'INVALID_STATUS');
    }

    const patch: Record<string, unknown> = {};
    if (status === 'confirmed' && !settlement.confirmed_at) patch.confirmed_at = nowIso();
    if (status === 'paid' && !settlement.paid_at) patch.paid_at = nowIso();
    await this.settlements.updateStatus(id, status, patch);
    return (await this.settlements.findById(id)) as SettlementRow;
  }

  /** 代理商详情：基础信息 + 下级用户 + 定价规则 */
  async agentDetail(agentId: number): Promise<{
    agent: { id: number; name: string; code: string; contactName: string | null; contactPhone: string | null; shareRatio: number; status: string };
    users: Array<{ userId: number; name: string; email: string }>;
    pricingRules: Array<{
      id: number;
      modelName: string;
      basePriceCents: number;
      tierThreshold: number;
      tier2PriceCents: number;
      shareRatio: number;
      effectiveFrom: string;
    }>;
  }> {
    const agent = await this.accounts.findAgentById(agentId);
    if (!agent) throw new NotFoundError(`代理商 #${agentId} 不存在`);
    const [users, rules] = await Promise.all([
      this.accounts.listAgentUsers(agentId),
      this.accounts.listPricingRules(),
    ]);
    return {
      agent: {
        id: agent.id,
        name: agent.name,
        code: agent.code,
        contactName: agent.contact_name ?? null,
        contactPhone: agent.contact_phone ?? null,
        shareRatio: Number(agent.share_ratio),
        status: agent.status,
      },
      users: users.map((row) => ({ userId: row.user_id, name: row.name, email: row.email })),
      pricingRules: rules
        .filter((rule) => rule.agent_id === agentId)
        .map((rule) => ({
          id: rule.id,
          modelName: rule.model_name,
          basePriceCents: Number(rule.base_price_cents),
          tierThreshold: Number(rule.tier_threshold),
          tier2PriceCents: Number(rule.tier2_price_cents),
          shareRatio: Number(rule.share_ratio),
          effectiveFrom: rule.effective_from,
        })),
    };
  }

  /** 代理商列表页：用户数 + 本月用量，供前端表格展示 */
  async agentOverview(): Promise<
    Array<{
      id: number;
      name: string;
      code: string;
      contactName: string | null;
      contactPhone: string | null;
      shareRatio: number;
      userCount: number;
      monthTasks: number;
      monthImages: number;
    }>
  > {
    const agents = await this.accounts.listAgents();
    const month = new Date();
    const from = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-01`;
    const to = new Date(month.getFullYear(), month.getMonth() + 1, 0).toISOString().slice(0, 10);
    const byAgent = await this.usage.byAgent({ from, to, status: 'completed' });

    return Promise.all(
      agents.map(async (agent) => {
        const users = await this.db('agent_user').where({ agent_id: agent.id }).count({ total: 'id' }).first();
        const stat = byAgent.find((row) => row.agentId === agent.id);
        return {
          id: agent.id,
          name: agent.name,
          code: agent.code,
          contactName: agent.contact_name ?? null,
          contactPhone: agent.contact_phone ?? null,
          shareRatio: Number(agent.share_ratio),
          userCount: Number(users?.total ?? 0),
          monthTasks: stat?.tasks ?? 0,
          monthImages: stat?.images ?? 0,
        };
      }),
    );
  }
}
