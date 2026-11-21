/** 用量统计：总数、成功率、P50/P95、按日趋势、按代理商/用户聚合 */
import { percentile, roundTo } from '../lib/utils.js';
import type { UsageFilters, UsageRepository, UsageTotals } from '../repositories/usageRepo.js';

export interface UsageStats {
  filters: UsageFilters;
  totals: UsageTotals;
  successRate: number;
  failureRate: number;
  p50DurationMs: number;
  p95DurationMs: number;
  avgDurationMs: number;
  avgGpuSeconds: number;
  trend: Array<{ date: string; tasks: number; images: number }>;
  byAgent: Array<{ agentId: number | null; agentName: string; tasks: number; images: number }>;
  byUser: Array<{ userId: number; userName: string; tasks: number; images: number }>;
}

export class UsageService {
  private readonly usage: UsageRepository;

  constructor(usage: UsageRepository) {
    this.usage = usage;
  }

  async stats(filters: UsageFilters): Promise<UsageStats> {
    const [totals, durations, trend, byAgent, byUser] = await Promise.all([
      this.usage.totals(filters),
      this.usage.durations(filters),
      this.usage.trend(filters),
      this.usage.byAgent(filters),
      this.usage.byUser(filters),
    ]);

    const finished = totals.succeeded + totals.failed;
    const avg = durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0;

    return {
      filters,
      totals,
      successRate: finished > 0 ? roundTo(totals.succeeded / finished, 4) : 0,
      failureRate: finished > 0 ? roundTo(totals.failed / finished, 4) : 0,
      p50DurationMs: percentile(durations, 50),
      p95DurationMs: percentile(durations, 95),
      avgDurationMs: Math.round(avg),
      avgGpuSeconds: totals.tasks > 0 ? roundTo(totals.gpuSeconds / totals.tasks, 2) : 0,
      trend,
      byAgent,
      byUser,
    };
  }
}
