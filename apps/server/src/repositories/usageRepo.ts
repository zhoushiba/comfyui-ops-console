/** 用量记录数据访问层：聚合统计 + 分页导出 */
import type { Knex } from 'knex';
import { insertReturningId, type Db } from '../db/knex.js';

export interface UsageRow {
  id: number;
  task_id: number;
  user_id: number;
  agent_id: number | null;
  model_name: string;
  status: string;
  image_count: number;
  duration_ms: number | null;
  gpu_seconds: number;
  billable: boolean | number;
  occurred_at: string;
  created_at: string;
}

export interface UsageFilters {
  from?: string;
  to?: string;
  agentId?: number;
  userId?: number;
  status?: string;
  modelName?: string;
}

export interface UsageTotals {
  tasks: number;
  images: number;
  gpuSeconds: number;
  succeeded: number;
  failed: number;
  billableTasks: number;
}

export interface TrendPoint {
  date: string;
  tasks: number;
  images: number;
}

export class UsageRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async create(data: Record<string, unknown>): Promise<number> {
    return insertReturningId(this.db, 'usage_record', data);
  }

  async findByTaskId(taskId: number): Promise<UsageRow | undefined> {
    return this.db<UsageRow>('usage_record').where({ task_id: taskId }).first();
  }

  private base(filters: UsageFilters): Knex.QueryBuilder {
    const query = this.db('usage_record as u');
    if (filters.from) query.where('u.occurred_at', '>=', filters.from);
    if (filters.to) query.where('u.occurred_at', '<=', filters.to);
    if (filters.agentId) query.where('u.agent_id', filters.agentId);
    if (filters.userId) query.where('u.user_id', filters.userId);
    if (filters.status) query.where('u.status', filters.status);
    if (filters.modelName) query.where('u.model_name', filters.modelName);
    return query;
  }

  async totals(filters: UsageFilters): Promise<UsageTotals> {
    const row = (await this.base(filters)
      .select(
        this.db.raw('count(*) as tasks'),
        this.db.raw('coalesce(sum(u.image_count), 0) as images'),
        this.db.raw('coalesce(sum(u.gpu_seconds), 0) as gpu_seconds'),
        this.db.raw("sum(case when u.status = 'completed' then 1 else 0 end) as succeeded"),
        this.db.raw("sum(case when u.status in ('failed','timeout','unreachable') then 1 else 0 end) as failed"),
        this.db.raw('sum(case when u.billable = 1 then 1 else 0 end) as billable_tasks'),
      )
      .first()) as Record<string, unknown> | undefined;

    return {
      tasks: Number(row?.tasks ?? 0),
      images: Number(row?.images ?? 0),
      gpuSeconds: Number(row?.gpu_seconds ?? 0),
      succeeded: Number(row?.succeeded ?? 0),
      failed: Number(row?.failed ?? 0),
      billableTasks: Number(row?.billable_tasks ?? 0),
    };
  }

  /** P50/P95 需要原始耗时序列，限制条数避免大表拖垮内存 */
  async durations(filters: UsageFilters, limit = 20_000): Promise<number[]> {
    const rows = (await this.base(filters)
      .select('u.duration_ms')
      .whereNotNull('u.duration_ms')
      .orderBy('u.duration_ms', 'asc')
      .limit(limit)) as Array<{ duration_ms: number | string }>;
    return rows.map((row) => Number(row.duration_ms)).filter((value) => Number.isFinite(value));
  }

  async trend(filters: UsageFilters): Promise<TrendPoint[]> {
    const rows = (await this.base(filters)
      .select('u.occurred_at as date')
      .count({ tasks: 'u.id' })
      .sum({ images: 'u.image_count' })
      .groupBy('u.occurred_at')
      .orderBy('u.occurred_at', 'asc')) as Array<{ date: string; tasks: number | string; images: number | string }>;
    return rows.map((row) => ({ date: row.date, tasks: Number(row.tasks), images: Number(row.images) }));
  }

  async byAgent(filters: UsageFilters): Promise<Array<{ agentId: number | null; agentName: string; tasks: number; images: number }>> {
    const rows = (await this.base(filters)
      .leftJoin('agent as a', 'a.id', 'u.agent_id')
      .select('u.agent_id as agentId', 'a.name as agentName')
      .count({ tasks: 'u.id' })
      .sum({ images: 'u.image_count' })
      .groupBy('u.agent_id', 'a.name')
      .orderBy('images', 'desc')) as Array<{
      agentId: number | null;
      agentName: string | null;
      tasks: number | string;
      images: number | string;
    }>;
    return rows.map((row) => ({
      agentId: row.agentId,
      agentName: row.agentName ?? '自营',
      tasks: Number(row.tasks),
      images: Number(row.images),
    }));
  }

  /** 分页明细（导出用），带任务号/用户名/代理商名 */
  async page(
    filters: UsageFilters,
    offset: number,
    limit: number,
  ): Promise<Array<Record<string, unknown>>> {
    const rows = (await this.base(filters)
      .leftJoin('generation_task as t', 't.id', 'u.task_id')
      .leftJoin('user as us', 'us.id', 'u.user_id')
      .leftJoin('agent as a', 'a.id', 'u.agent_id')
      .select(
        'u.*',
        't.task_no as task_no',
        't.prompt_text as prompt_text',
        'us.name as user_name',
        'a.name as agent_name',
      )
      .orderBy('u.id', 'asc')
      .offset(offset)
      .limit(limit)) as Array<Record<string, unknown>>;
    return rows;
  }

  async count(filters: UsageFilters): Promise<number> {
    const row = await this.base(filters).count({ total: 'u.id' }).first();
    return Number(row?.total ?? 0);
  }

  /**
   * 结算取数：只取"成功且计费"的记录，按 id 升序，
   * 以便按时间顺序做阶梯累计（后出现的图片落在更高档位）。
   */
  async settlementSource(
    agentId: number,
    from: string,
    to: string,
  ): Promise<Array<UsageRow & { task_no: string; user_name: string }>> {
    return (await this.db('usage_record as u')
      .leftJoin('generation_task as t', 't.id', 'u.task_id')
      .leftJoin('user as us', 'us.id', 'u.user_id')
      .select('u.*', 't.task_no as task_no', 'us.name as user_name')
      .where('u.agent_id', agentId)
      .andWhere('u.occurred_at', '>=', from)
      .andWhere('u.occurred_at', '<=', to)
      .andWhere('u.status', 'completed')
      .andWhere('u.billable', true)
      .orderBy('u.id', 'asc')) as Array<UsageRow & { task_no: string; user_name: string }>;
  }

  /** 按用户聚合（结算单里展示下级用户消耗） */
  async byUser(
    filters: UsageFilters,
  ): Promise<Array<{ userId: number; userName: string; tasks: number; images: number }>> {
    const rows = (await this.base(filters)
      .leftJoin('user as us', 'us.id', 'u.user_id')
      .select('u.user_id as userId', 'us.name as userName')
      .count({ tasks: 'u.id' })
      .sum({ images: 'u.image_count' })
      .groupBy('u.user_id', 'us.name')
      .orderBy('images', 'desc')) as Array<{
      userId: number;
      userName: string | null;
      tasks: number | string;
      images: number | string;
    }>;
    return rows.map((row) => ({
      userId: Number(row.userId),
      userName: row.userName ?? `用户#${row.userId}`,
      tasks: Number(row.tasks),
      images: Number(row.images),
    }));
  }
}
