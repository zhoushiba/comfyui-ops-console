/** 任务与尝试记录的数据访问层 */
import type { Knex } from 'knex';
import { insertReturningId, type Db } from '../db/knex.js';

export type TaskStatus =
  | 'queued'
  | 'submitted'
  | 'running'
  | 'polling'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'unreachable';

export interface TaskRow {
  id: number;
  task_no: string;
  user_id: number;
  agent_id: number | null;
  template_id: number | null;
  client_request_id: string | null;
  status: TaskStatus;
  prompt_text: string;
  negative_prompt: string | null;
  params_json: string;
  graph_json: string;
  comfyui_prompt_id: string | null;
  progress: number;
  error_code: string | null;
  error_message: string | null;
  error_detail: string | null;
  attempts: number;
  submitted_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  image_count: number;
  gpu_seconds: number;
  created_at: string;
}

export interface TaskAttemptRow {
  id: number;
  task_id: number;
  attempt_no: number;
  status: string;
  stage: string;
  http_status: number | null;
  error_type: string | null;
  error_message: string | null;
  backoff_ms: number;
  started_at: string;
  finished_at: string | null;
}

export interface TaskFilters {
  status?: string;
  userId?: number;
  agentId?: number;
  from?: string;
  to?: string;
  keyword?: string;
}

export interface TaskListResult {
  items: Array<TaskRow & { user_name?: string; agent_name?: string; template_name?: string }>;
  total: number;
}

export class TaskRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async create(data: Record<string, unknown>): Promise<number> {
    return insertReturningId(this.db, 'generation_task', data);
  }

  async findById(id: number): Promise<TaskRow | undefined> {
    return this.db<TaskRow>('generation_task').where({ id }).first();
  }

  async findByClientRequestId(userId: number, clientRequestId: string): Promise<TaskRow | undefined> {
    return this.db<TaskRow>('generation_task')
      .where({ user_id: userId, client_request_id: clientRequestId })
      .first();
  }

  async update(id: number, patch: Partial<Record<keyof TaskRow, unknown>>): Promise<void> {
    await this.db('generation_task').where({ id }).update(patch);
  }

  private applyFilters(query: Knex.QueryBuilder, filters: TaskFilters): void {
    if (filters.status) query.where('t.status', filters.status);
    if (filters.userId) query.where('t.user_id', filters.userId);
    if (filters.agentId) query.where('t.agent_id', filters.agentId);
    if (filters.from) query.where('t.created_at', '>=', `${filters.from}T00:00:00.000Z`);
    if (filters.to) query.where('t.created_at', '<=', `${filters.to}T23:59:59.999Z`);
    if (filters.keyword) {
      const keyword = `%${filters.keyword}%`;
      query.where((builder) => {
        builder.where('t.task_no', 'like', keyword).orWhere('t.prompt_text', 'like', keyword);
      });
    }
  }

  async list(filters: TaskFilters, page: number, pageSize: number): Promise<TaskListResult> {
    const base = this.db('generation_task as t')
      .leftJoin('user as u', 'u.id', 't.user_id')
      .leftJoin('agent as a', 'a.id', 't.agent_id')
      .leftJoin('prompt_template as pt', 'pt.id', 't.template_id');

    this.applyFilters(base, filters);

    const countRow = await base.clone().clearSelect().clearOrder().count({ total: 't.id' }).first();
    const items = await base
      .clone()
      .select(
        't.*',
        'u.name as user_name',
        'a.name as agent_name',
        'pt.name as template_name',
      )
      .orderBy('t.id', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return { items: items as TaskListResult['items'], total: Number(countRow?.total ?? 0) };
  }

  async listRecent(limit: number): Promise<Array<TaskRow & { user_name?: string; agent_name?: string }>> {
    const rows = await this.db('generation_task as t')
      .leftJoin('user as u', 'u.id', 't.user_id')
      .leftJoin('agent as a', 'a.id', 't.agent_id')
      .select('t.*', 'u.name as user_name', 'a.name as agent_name')
      .orderBy('t.id', 'desc')
      .limit(limit);
    return rows as Array<TaskRow & { user_name?: string; agent_name?: string }>;
  }

  async countByStatus(): Promise<Record<string, number>> {
    const rows = (await this.db('generation_task')
      .select('status')
      .count({ count: 'id' })
      .groupBy('status')) as Array<{ status: string; count: number | string }>;
    const result: Record<string, number> = {};
    for (const row of rows) result[row.status] = Number(row.count);
    return result;
  }

  async countCreatedSince(iso: string): Promise<number> {
    const row = await this.db('generation_task').where('created_at', '>=', iso).count({ total: 'id' }).first();
    return Number(row?.total ?? 0);
  }

  async addAttempt(data: Record<string, unknown>): Promise<number> {
    return insertReturningId(this.db, 'task_attempt', data);
  }

  async listAttempts(taskId: number): Promise<TaskAttemptRow[]> {
    return this.db<TaskAttemptRow>('task_attempt').where({ task_id: taskId }).orderBy('attempt_no', 'asc');
  }

  async listQueued(limit: number): Promise<TaskRow[]> {
    return this.db<TaskRow>('generation_task')
      .whereIn('status', ['queued', 'submitted', 'running', 'polling', 'downloading'])
      .orderBy('id', 'asc')
      .limit(limit);
  }

  /** 服务重启时把中断的任务标记为失败，避免永远卡在中间态 */
  async failInterrupted(message: string, nowIso: string): Promise<number> {
    return this.db('generation_task')
      .whereIn('status', ['submitted', 'running', 'polling', 'downloading'])
      .update({
        status: 'failed',
        error_code: 'SERVER_RESTARTED',
        error_message: message,
        finished_at: nowIso,
      });
  }
}
