/**
 * 结算金额计算（纯函数，重点单测对象）。
 *
 * 计价模型：
 *   - 阶梯一：前 tierThreshold 张，单价 basePriceCents；
 *   - 阶梯二：超出部分，单价 tier2PriceCents（阶梯折扣）；
 *   - 代理商分成 shareRatio（0~1），平台抽成 = 流水 - 代理商应结。
 *
 * 金额全部用"分"的整数计算，避免浮点误差；分成四舍五入到分。
 */

export interface PricingRuleInput {
  basePriceCents: number;
  tierThreshold: number;
  tier2PriceCents: number;
  shareRatio: number;
}

export interface SettlementTier {
  label: string;
  imageCount: number;
  unitPriceCents: number;
  amountCents: number;
}

export interface SettlementAmount {
  imageCount: number;
  grossCents: number;
  platformFeeCents: number;
  agentAmountCents: number;
  shareRatio: number;
  tiers: SettlementTier[];
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} 必须为非负数，实际为 ${value}`);
  }
}

/** 校验定价规则，越界直接抛错（由路由层转成 400） */
export function validatePricingRule(rule: PricingRuleInput): void {
  assertNonNegativeInteger(rule.basePriceCents, 'basePriceCents');
  assertNonNegativeInteger(rule.tier2PriceCents, 'tier2PriceCents');
  assertNonNegativeInteger(rule.tierThreshold, 'tierThreshold');
  if (!Number.isFinite(rule.shareRatio) || rule.shareRatio < 0 || rule.shareRatio > 1) {
    throw new Error(`shareRatio 必须在 0~1 之间，实际为 ${rule.shareRatio}`);
  }
}

/**
 * 计算应结金额。
 * 例：base=120分、阈值=1000、tier2=100分、分成=0.7
 *   1200 张 → 1000*120 + 200*100 = 140000 分，代理商 98000 分，平台 42000 分。
 */
export function calculateSettlementAmount(imageCount: number, rule: PricingRuleInput): SettlementAmount {
  validatePricingRule(rule);
  const count = Math.max(0, Math.floor(imageCount));
  const tier1Count = Math.min(count, rule.tierThreshold);
  const tier2Count = Math.max(0, count - rule.tierThreshold);

  const tier1Amount = tier1Count * rule.basePriceCents;
  const tier2Amount = tier2Count * rule.tier2PriceCents;
  const grossCents = tier1Amount + tier2Amount;

  // 四舍五入到分：0.005 分四舍五入
  const agentAmountCents = Math.round(grossCents * rule.shareRatio);
  const platformFeeCents = grossCents - agentAmountCents;

  const tiers: SettlementTier[] = [
    {
      label: `阶梯一（≤${rule.tierThreshold} 张）`,
      imageCount: tier1Count,
      unitPriceCents: rule.basePriceCents,
      amountCents: tier1Amount,
    },
  ];
  if (tier2Count > 0) {
    tiers.push({
      label: `阶梯二（>${rule.tierThreshold} 张）`,
      imageCount: tier2Count,
      unitPriceCents: rule.tier2PriceCents,
      amountCents: tier2Amount,
    });
  }

  return {
    imageCount: count,
    grossCents,
    platformFeeCents,
    agentAmountCents,
    shareRatio: rule.shareRatio,
    tiers,
  };
}
