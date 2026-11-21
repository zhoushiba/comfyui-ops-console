/**
 * Knex 连接工厂：默认 better-sqlite3（本地零依赖），
 * 设置 DATABASE_URL 即可切到 MySQL 8 / PostgreSQL 16，同一套 schema 与查询。
 */
import knex, { type Knex } from 'knex';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AppConfig } from '../config.js';

export type Db = Knex;

export function createDb(config: AppConfig): Db {
  if (config.dbClient === 'mysql') {
    return knex({
      client: 'mysql2',
      connection: config.databaseUrl ?? {
        host: '127.0.0.1',
        port: 3306,
        user: 'ops',
        password: 'ops_password',
        database: 'comfyui_ops',
      },
      pool: { min: 1, max: 10 },
      acquireConnectionTimeout: 10_000,
    });
  }

  if (config.dbClient === 'pg') {
    return knex({
      client: 'pg',
      connection: config.databaseUrl ?? 'postgres://ops:ops_password@127.0.0.1:5432/comfyui_ops',
      pool: { min: 1, max: 10 },
    });
  }

  // better-sqlite3 不会自动创建目录，先保证 ./data 存在
  mkdirSync(dirname(config.dbFilename), { recursive: true });
  return knex({
    client: 'better-sqlite3',
    connection: { filename: config.dbFilename },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });
}

/** 跨数据库的主键返回：MySQL 返回 [id]，PG 需要 returning */
export function isPg(db: Db): boolean {
  return db.client.config.client === 'pg' || db.client.config.client === 'pg-native';
}

/** 插入一条记录并返回自增主键 */
export async function insertReturningId(db: Db, table: string, data: Record<string, unknown>): Promise<number> {
  if (isPg(db)) {
    const rows = (await db(table).insert(data).returning('id')) as Array<{ id: number } | number>;
    const first = rows[0];
    return typeof first === 'number' ? first : Number(first?.id ?? 0);
  }
  const ids = (await db(table).insert(data)) as unknown[];
  return Number(ids[0] ?? 0);
}

/** 时间统一以 ISO 字符串写入与返回，避免 sqlite/pg 类型差异 */
export function nowIso(): string {
  return new Date().toISOString();
}

/** 取某个时间点所属的自然日（本地时区） */
export function toDateKey(date: Date | string = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
