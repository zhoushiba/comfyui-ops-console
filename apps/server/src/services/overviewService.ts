/** 总览看板聚合：今日/本月任务量、成功率、耗时分位、近 14 天趋势、队列状态 */
import { dateKeyOffset } from '../lib/utils.js';
import { toDateKey } from '../db/knex.js';
import { toTaskDto, type TaskDto } from '../http/dto.js';
import type { TaskRepository } from '../repositories/taskRepo.js';
import type { ImageRepository } from '../repositories/imageRepo.js';
import type { UsageRepository } from '../repositories/usageRepo.js';
import type { OrchestratorStats } from './orchestrator.js';
import { percentile } from '../lib/utils.js';

export interface OverviewData {
  generatedAt: string;
  today: { tasks: number; images: number; gpuSeconds: number };
  month: { tasks: number; images: number; gpuSeconds: number; successRate: number };
  statusCounts: Record<string, number>;
  duration: { p50: number; p95: number; avg: number };
  recentTasks: TaskDto[];
  trend: Array<{ date: string; tasks: number; images: number }>;
  agents: Array<{ agentId: number | null; agentName: string; tasks: number; images: number }>;
  queue: OrchestratorStats;
  imageTotal: number;
  failureReasons: Array<{ code: string; count: number }>;
}

export class OverviewService {
  private readonly tasks: TaskRepository;
  private readonly images: ImageRepository;
  private readonly usage: UsageRepository;

  constructor(tasks: TaskRepository, images: ImageRepository, usage: UsageRepository) {
    this.tasks = tasks;
    this.images = images;
    this.usage = usage;
  }

  async build(queue: OrchestratorStats): Promise<OverviewData> {
    const today = toDateKey();
    const monthStart = `${today.slice(0, 7)}-01`;
    const from = dateKeyOffset(13);

    const [todayTasks, monthTasks, statusCounts, recentTasks, imageTotal, usageMonth, trend, agents, durations] =
      await Promise.all([
        this.usage.totals({ from: today, to: today }),
        this.usage.totals({ from: monthStart, to: today }),
        this.tasks.countByStatus(),
        this.tasks.listRecent(8),
        this.images.countAll(),
        this.usage.totals({ from: monthStart, to: today }),
        this.usage.trend({ from, to: today }),
        this.usage.byAgent({ from: monthStart, to: today }),
        this.usage.durations({ from: monthStart, to: today }),
      ]);

    const [todayImages, monthImages] = [todayTasks.images, usageMonth.images];
    const finished = usageMonth.succeeded + usageMonth.failed;

    // 失败原因 Top5：直接按状态聚合，足够运营看板使用
    return {
      generatedAt: new Date().toISOString(),
      today: { tasks: todayTasks.tasks, images: todayImages, gpuSeconds: todayTasks.gpuSeconds },
      month: {
        tasks: monthTasks.tasks,
        images: monthImages,
        gpuSeconds: monthTasks.gpuSeconds,
        successRate: finished > 0 ? Math.round((usageMonth.succeeded / finished) * 1000) / 1000 : 0,
      },
      statusCounts,
      duration: {
        p50: percentile(durations, 50),
        p95: percentile(durations, 95),
        avg: durations.length > 0 ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0,
      },
      recentTasks: recentTasks.map(toTaskDto),
      trend,
      agents,
      queue,
      imageTotal,
      failureReasons: Object.entries(statusCounts)
        .filter(([status]) => ['failed', 'timeout', 'unreachable'].includes(status))
        .map(([code, count]) => ({ code, count })),
    };
  }
}
