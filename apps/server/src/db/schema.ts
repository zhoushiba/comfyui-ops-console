/**
 * 建表脚本（幂等）。
 *
 * 为什么不用 knex migrate 文件？本项目要同时支持 sqlite / mysql / pg，
 * 这里用 knex.schema 的公共子集表达，三条数据库执行同一份定义；
 * 同时 db/schema.mysql.sql 提供可读的 MySQL 建表参考（与这里保持一致）。
 */
import type { Db } from './knex.js';

export async function ensureSchema(db: Db): Promise<void> {
  // 用户与代理商 ------------------------------------------------------------
  if (!(await db.schema.hasTable('agent'))) {
    await db.schema.createTable('agent', (t) => {
      t.increments('id').primary();
      t.string('name', 120).notNullable();
      t.string('code', 64).notNullable().unique();
      t.string('contact_name', 64);
      t.string('contact_phone', 32);
      t.decimal('share_ratio', 6, 4).notNullable().defaultTo(0.7);
      t.string('status', 16).notNullable().defaultTo('active');
      t.string('created_at', 32).notNullable();
    });
  }

  if (!(await db.schema.hasTable('user'))) {
    await db.schema.createTable('user', (t) => {
      t.increments('id').primary();
      t.string('email', 190).notNullable().unique();
      t.string('name', 64).notNullable();
      t.string('password_hash', 255).notNullable();
      t.string('role', 24).notNullable().defaultTo('operator');
      t.integer('agent_id').unsigned().nullable().index();
      t.string('status', 16).notNullable().defaultTo('active');
      t.string('created_at', 32).notNullable();
    });
  }

  if (!(await db.schema.hasTable('agent_user'))) {
    await db.schema.createTable('agent_user', (t) => {
      t.increments('id').primary();
      t.integer('agent_id').unsigned().notNullable().index();
      t.integer('user_id').unsigned().notNullable().unique();
      t.string('joined_at', 32).notNullable();
    });
  }

  // 模板与任务 --------------------------------------------------------------
  if (!(await db.schema.hasTable('prompt_template'))) {
    await db.schema.createTable('prompt_template', (t) => {
      t.increments('id').primary();
      t.string('name', 120).notNullable();
      t.string('description', 500);
      t.string('model_name', 120).notNullable().defaultTo('sd_xl_base_1.0.safetensors');
      t.text('graph_json').notNullable();
      t.text('default_params_json');
      t.boolean('is_active').notNullable().defaultTo(true);
      t.integer('created_by').unsigned().nullable();
      t.string('created_at', 32).notNullable();
    });
  }

  if (!(await db.schema.hasTable('generation_task'))) {
    await db.schema.createTable('generation_task', (t) => {
      t.increments('id').primary();
      t.string('task_no', 40).notNullable().unique();
      t.integer('user_id').unsigned().notNullable().index();
      t.integer('agent_id').unsigned().nullable().index();
      t.integer('template_id').unsigned().nullable();
      t.string('client_request_id', 80).nullable();
      t.string('status', 24).notNullable().defaultTo('queued').index();
      t.string('prompt_text', 1000).notNullable();
      t.string('negative_prompt', 1000);
      t.text('params_json').notNullable();
      t.text('graph_json').notNullable();
      t.string('comfyui_prompt_id', 64).nullable().index();
      t.integer('progress').notNullable().defaultTo(0);
      t.string('error_code', 64).nullable();
      t.string('error_message', 1000).nullable();
      t.text('error_detail').nullable();
      t.integer('attempts').notNullable().defaultTo(0);
      t.string('submitted_at', 32).nullable();
      t.string('started_at', 32).nullable();
      t.string('finished_at', 32).nullable();
      t.integer('duration_ms').nullable();
      t.integer('image_count').notNullable().defaultTo(0);
      t.integer('gpu_seconds').notNullable().defaultTo(0);
      t.string('created_at', 32).notNullable();
      t.unique(['user_id', 'client_request_id'], { indexName: 'uq_task_idempotent' });
      t.index(['created_at'], 'idx_task_created');
    });
  }

  if (!(await db.schema.hasTable('task_attempt'))) {
    await db.schema.createTable('task_attempt', (t) => {
      t.increments('id').primary();
      t.integer('task_id').unsigned().notNullable().index();
      t.integer('attempt_no').notNullable();
      t.string('status', 24).notNullable();
      t.string('stage', 24).notNullable();
      t.integer('http_status').nullable();
      t.string('error_type', 64).nullable();
      t.string('error_message', 1000).nullable();
      t.integer('backoff_ms').notNullable().defaultTo(0);
      t.string('started_at', 32).notNullable();
      t.string('finished_at', 32).nullable();
    });
  }

  // 图片 --------------------------------------------------------------------
  if (!(await db.schema.hasTable('image_asset'))) {
    await db.schema.createTable('image_asset', (t) => {
      t.increments('id').primary();
      t.integer('task_id').unsigned().notNullable().index();
      t.integer('user_id').unsigned().notNullable().index();
      t.integer('agent_id').unsigned().nullable().index();
      t.string('filename', 190).notNullable();
      t.string('storage_path', 500).notNullable();
      t.string('mime_type', 64).notNullable();
      t.string('format', 16).notNullable();
      t.integer('width').nullable();
      t.integer('height').nullable();
      t.integer('byte_size').notNullable();
      t.string('sha256', 64).notNullable();
      t.string('thumbnail_path', 500).nullable();
      t.string('converted_path', 500).nullable();
      t.integer('source_image_id').unsigned().nullable().index();
      t.string('created_at', 32).notNullable();
    });
  }

  // 用量与结算 --------------------------------------------------------------
  if (!(await db.schema.hasTable('usage_record'))) {
    await db.schema.createTable('usage_record', (t) => {
      t.increments('id').primary();
      t.integer('task_id').unsigned().notNullable().unique();
      t.integer('user_id').unsigned().notNullable().index();
      t.integer('agent_id').unsigned().nullable().index();
      t.string('model_name', 120).notNullable();
      t.string('status', 24).notNullable();
      t.integer('image_count').notNullable().defaultTo(0);
      t.integer('duration_ms').nullable();
      t.integer('gpu_seconds').notNullable().defaultTo(0);
      t.boolean('billable').notNullable().defaultTo(true);
      t.string('occurred_at', 10).notNullable().index();
      t.string('created_at', 32).notNullable();
    });
  }

  if (!(await db.schema.hasTable('pricing_rule'))) {
    await db.schema.createTable('pricing_rule', (t) => {
      t.increments('id').primary();
      t.integer('agent_id').unsigned().notNullable().index();
      t.string('model_name', 120).notNullable().defaultTo('*');
      t.integer('base_price_cents').notNullable().defaultTo(120);
      t.integer('tier_threshold').notNullable().defaultTo(1000);
      t.integer('tier2_price_cents').notNullable().defaultTo(100);
      t.decimal('share_ratio', 6, 4).notNullable().defaultTo(0.7);
      t.string('effective_from', 10).notNullable();
      t.string('created_at', 32).notNullable();
    });
  }

  if (!(await db.schema.hasTable('settlement'))) {
    await db.schema.createTable('settlement', (t) => {
      t.increments('id').primary();
      t.string('settlement_no', 40).notNullable().unique();
      t.integer('agent_id').unsigned().notNullable().index();
      t.string('period_start', 10).notNullable();
      t.string('period_end', 10).notNullable();
      t.string('status', 24).notNullable().defaultTo('pending');
      t.integer('task_count').notNullable().defaultTo(0);
      t.integer('image_count').notNullable().defaultTo(0);
      t.integer('gross_cents').notNullable().defaultTo(0);
      t.integer('platform_fee_cents').notNullable().defaultTo(0);
      t.integer('agent_amount_cents').notNullable().defaultTo(0);
      t.string('confirmed_at', 32).nullable();
      t.string('paid_at', 32).nullable();
      t.string('created_at', 32).notNullable();
    });
  }

  if (!(await db.schema.hasTable('settlement_item'))) {
    await db.schema.createTable('settlement_item', (t) => {
      t.increments('id').primary();
      t.integer('settlement_id').unsigned().notNullable().index();
      t.integer('usage_record_id').unsigned().nullable().index();
      t.string('description', 255).notNullable();
      t.integer('image_count').notNullable();
      t.integer('unit_price_cents').notNullable();
      t.integer('amount_cents').notNullable();
      t.string('created_at', 32).notNullable();
    });
  }

  // 审计与配置 --------------------------------------------------------------
  if (!(await db.schema.hasTable('audit_log'))) {
    await db.schema.createTable('audit_log', (t) => {
      t.increments('id').primary();
      t.integer('actor_id').unsigned().nullable().index();
      t.string('action', 64).notNullable().index();
      t.string('target_type', 48);
      t.string('target_id', 64);
      t.text('detail_json');
      t.string('ip', 64);
      t.string('created_at', 32).notNullable();
    });
  }

  if (!(await db.schema.hasTable('system_config'))) {
    await db.schema.createTable('system_config', (t) => {
      t.string('key', 96).primary();
      t.text('value').notNullable();
      t.string('updated_at', 32).notNullable();
    });
  }
}

/** 清空所有业务数据（seed/测试用），保留表结构 */
export async function truncateAll(db: Db): Promise<void> {
  const tables = [
    'settlement_item',
    'settlement',
    'usage_record',
    'image_asset',
    'task_attempt',
    'generation_task',
    'prompt_template',
    'agent_user',
    'user',
    'agent',
    'pricing_rule',
    'audit_log',
    'system_config',
  ];
  for (const table of tables) {
    await db(table).del();
  }
}
