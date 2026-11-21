/** 结算金额：单档、跨档阶梯、分成四舍五入、边界与非法规则 */
import { describe, expect, it } from 'vitest';
import {
  calculateSettlementAmount,
  validatePricingRule,
  type PricingRuleInput,
} from '../src/services/settlementCalculator.js';
import { allocateItems } from '../src/services/settlementService.js';

const RULE: PricingRuleInput = {
  basePriceCents: 120,
  tierThreshold: 1000,
  tier2PriceCents: 100,
  shareRatio: 0.7,
};

describe('calculateSettlementAmount', () => {
  it('单档：100 张 × 120 分，平台 20%，代理商 80%', () => {
    const amount = calculateSettlementAmount(100, RULE);
    expect(amount.grossCents).toBe(12000);
    expect(amount.agentAmountCents).toBe(8400);
    expect(amount.platformFeeCents).toBe(3600);
    expect(amount.tiers).toHaveLength(1);
    expect(amount.tiers[0]).toMatchObject({ imageCount: 100, unitPriceCents: 120, amountCents: 12000 });
  });

  it('跨档：1200 张 = 1000×120 + 200×100，阶梯明细可核对', () => {
    const amount = calculateSettlementAmount(1200, RULE);
    expect(amount.grossCents).toBe(140000);
    expect(amount.agentAmountCents).toBe(98000);
    expect(amount.platformFeeCents).toBe(42000);
    expect(amount.tiers).toEqual([
      expect.objectContaining({ imageCount: 1000, unitPriceCents: 120, amountCents: 120000 }),
      expect.objectContaining({ imageCount: 200, unitPriceCents: 100, amountCents: 20000 }),
    ]);
  });

  it('恰好等于阶梯阈值时只有一条阶梯明细', () => {
    const amount = calculateSettlementAmount(1000, RULE);
    expect(amount.grossCents).toBe(120000);
    expect(amount.tiers).toHaveLength(1);
  });

  it('0 张图片金额为 0', () => {
    const amount = calculateSettlementAmount(0, RULE);
    expect(amount).toMatchObject({ grossCents: 0, platformFeeCents: 0, agentAmountCents: 0 });
  });

  it('分成四舍五入到分：1 分流水 × 0.5 = 1 分（0.5 进位）', () => {
    const amount = calculateSettlementAmount(1, { ...RULE, basePriceCents: 1, shareRatio: 0.5 });
    expect(amount.grossCents).toBe(1);
    expect(amount.agentAmountCents).toBe(1);
    expect(amount.platformFeeCents).toBe(0);
  });

  it('分数比例边界 0 与 1', () => {
    expect(calculateSettlementAmount(10, { ...RULE, shareRatio: 0 }).agentAmountCents).toBe(0);
    expect(calculateSettlementAmount(10, { ...RULE, shareRatio: 1 }).agentAmountCents).toBe(1200);
  });

  it('非法规则抛错：分成超出 0~1、负单价', () => {
    expect(() => validatePricingRule({ ...RULE, shareRatio: 1.5 })).toThrow('shareRatio');
    expect(() => calculateSettlementAmount(1, { ...RULE, basePriceCents: -1 })).toThrow('basePriceCents');
  });
});

describe('allocateItems 阶梯明细拆分', () => {
  it('跨档任务被拆成两条明细，合计等于阶梯总额', () => {
    const items = allocateItems(
      [
        { id: 1, image_count: 800, task_no: 'T1', user_name: '小林' },
        { id: 2, image_count: 400, task_no: 'T2', user_name: '阿蓝' },
      ],
      RULE,
    );
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ usageRecordId: 1, imageCount: 800, unitPriceCents: 120 });
    expect(items[1]).toMatchObject({ usageRecordId: 2, imageCount: 200, unitPriceCents: 120 });
    expect(items[2]).toMatchObject({ usageRecordId: 2, imageCount: 200, unitPriceCents: 100 });
    const total = items.reduce((sum, item) => sum + item.amountCents, 0);
    expect(total).toBe(calculateSettlementAmount(1200, RULE).grossCents);
  });

  it('图片数为 0 的用量记录被跳过', () => {
    const items = allocateItems([{ id: 1, image_count: 0 }], RULE);
    expect(items).toEqual([]);
  });
});
