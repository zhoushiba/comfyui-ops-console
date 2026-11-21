/** 系统配置与审计日志 */
import { insertReturningId, nowIso, type Db } from '../db/knex.js';

export class ConfigRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async all(): Promise<Record<string, string>> {
    const rows = (await this.db('system_config').select('*')) as Array<{ key: string; value: string }>;
    const result: Record<string, string> = {};
    for (const row of rows) result[row.key] = row.value;
    return result;
  }

  async get(key: string): Promise<string | undefined> {
    const row = await this.db('system_config').where({ key }).first();
    return row?.value;
  }

  async set(key: string, value: string): Promise<void> {
    const existing = await this.get(key);
    if (existing === undefined) {
      await this.db('system_config').insert({ key, value, updated_at: nowIso() });
    } else {
      await this.db('system_config').where({ key }).update({ value, updated_at: nowIso() });
    }
  }

  async setMany(values: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      await this.set(key, value);
    }
  }
}

export interface AuditEntry {
  actorId: number | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  detail?: unknown;
  ip?: string | null;
}

export class AuditRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async record(entry: AuditEntry): Promise<number> {
    return insertReturningId(this.db, 'audit_log', {
      actor_id: entry.actorId,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      detail_json: entry.detail === undefined ? null : JSON.stringify(entry.detail),
      ip: entry.ip ?? null,
      created_at: nowIso(),
    });
  }

  async list(limit = 50): Promise<Array<Record<string, unknown>>> {
    return this.db('audit_log as l')
      .leftJoin('user as u', 'u.id', 'l.actor_id')
      .select('l.*', 'u.name as actor_name')
      .orderBy('l.id', 'desc')
      .limit(limit) as Promise<Array<Record<string, unknown>>>;
  }
}
