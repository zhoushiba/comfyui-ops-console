/** 图片资产数据访问层 */
import type { Knex } from 'knex';
import { insertReturningId, type Db } from '../db/knex.js';

export interface ImageRow {
  id: number;
  task_id: number;
  user_id: number;
  agent_id: number | null;
  filename: string;
  storage_path: string;
  mime_type: string;
  format: string;
  width: number | null;
  height: number | null;
  byte_size: number;
  sha256: string;
  thumbnail_path: string | null;
  converted_path: string | null;
  source_image_id: number | null;
  created_at: string;
}

export interface ImageFilters {
  userId?: number;
  agentId?: number;
  taskId?: number;
  format?: string;
  includeDerived?: boolean;
}

export class ImageRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async create(data: Record<string, unknown>): Promise<number> {
    return insertReturningId(this.db, 'image_asset', data);
  }

  async findById(id: number): Promise<ImageRow | undefined> {
    return this.db<ImageRow>('image_asset').where({ id }).first();
  }

  async listByTask(taskId: number): Promise<ImageRow[]> {
    return this.db<ImageRow>('image_asset').where({ task_id: taskId }).orderBy('id', 'asc');
  }

  private applyFilters(query: Knex.QueryBuilder, filters: ImageFilters): void {
    if (filters.userId) query.where('i.user_id', filters.userId);
    if (filters.agentId) query.where('i.agent_id', filters.agentId);
    if (filters.taskId) query.where('i.task_id', filters.taskId);
    if (filters.format) query.where('i.format', filters.format);
    if (!filters.includeDerived) query.whereNull('i.source_image_id');
  }

  async list(
    filters: ImageFilters,
    page: number,
    pageSize: number,
  ): Promise<{ items: Array<ImageRow & { task_no?: string; prompt_text?: string }>; total: number }> {
    const base = this.db('image_asset as i').leftJoin('generation_task as t', 't.id', 'i.task_id');
    this.applyFilters(base, filters);
    const countRow = await base.clone().clearSelect().clearOrder().count({ total: 'i.id' }).first();
    const items = await base
      .clone()
      .select('i.*', 't.task_no as task_no', 't.prompt_text as prompt_text')
      .orderBy('i.id', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return { items: items as Array<ImageRow & { task_no?: string; prompt_text?: string }>, total: Number(countRow?.total ?? 0) };
  }

  async countAll(): Promise<number> {
    const row = await this.db('image_asset').whereNull('source_image_id').count({ total: 'id' }).first();
    return Number(row?.total ?? 0);
  }

  async update(id: number, patch: Partial<Record<keyof ImageRow, unknown>>): Promise<void> {
    await this.db('image_asset').where({ id }).update(patch);
  }

  /** 重试前清掉半成品记录（含派生图），保证任务图片集合不重复 */
  async deleteByTask(taskId: number): Promise<void> {
    await this.db('image_asset').where({ task_id: taskId }).del();
  }
}
