/**
 * 运行时配置。全部来自环境变量，加载顺序：
 *   1. 进程已有环境变量
 *   2. apps/server/.env（存在则加载，不覆盖已存在的值）
 *   3. 代码默认值
 *
 * 注意：DATABASE_URL 存在时优先于 DB_CLIENT，用于生产环境切换 MySQL/PG。
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

export type DbClient = 'sqlite' | 'mysql' | 'pg';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  host: string;
  dbClient: DbClient;
  dbFilename: string;
  databaseUrl: string | null;
  comfyuiBaseUrl: string;
  comfyuiRequestTimeoutMs: number;
  comfyuiPollIntervalMs: number;
  comfyuiJobTimeoutMs: number;
  comfyuiMaxRetries: number;
  orchestratorConcurrency: number;
  storageDir: string;
  thumbnailSize: number;
  tokenSecret: string;
  tokenTtlSeconds: number;
  platformFeeRatio: number;
  logLevel: string;
}

function readInt(value: string | undefined, fallback: number, min = 0): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function readFloat(value: string | undefined, fallback: number, min = 0, max = 1): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

/** 只在文件存在时加载 .env，避免 ENOENT */
export function loadDotEnv(rootDir: string): void {
  const envPath = path.join(rootDir, '.env');
  if (!existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch {
    // .env 格式错误不阻断启动，使用默认值
  }
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const env = process.env;
  const databaseUrl = env.DATABASE_URL?.trim() || null;
  const inferredClient: DbClient = databaseUrl
    ? databaseUrl.startsWith('mysql')
      ? 'mysql'
      : databaseUrl.startsWith('postgres')
        ? 'pg'
        : 'sqlite'
    : ((env.DB_CLIENT as DbClient) ?? 'sqlite');

  const config: AppConfig = {
    nodeEnv: env.NODE_ENV ?? 'development',
    port: readInt(env.PORT, 3000, 1),
    host: env.HOST ?? '0.0.0.0',
    dbClient: inferredClient,
    dbFilename: env.DB_FILENAME ?? './data/app.db',
    databaseUrl,
    comfyuiBaseUrl: env.COMFYUI_BASE_URL ?? 'http://127.0.0.1:8188',
    comfyuiRequestTimeoutMs: readInt(env.COMFYUI_REQUEST_TIMEOUT_MS, 10_000, 50),
    comfyuiPollIntervalMs: readInt(env.COMFYUI_POLL_INTERVAL_MS, 800, 20),
    comfyuiJobTimeoutMs: readInt(env.COMFYUI_JOB_TIMEOUT_MS, 60_000, 100),
    comfyuiMaxRetries: readInt(env.COMFYUI_MAX_RETRIES, 3, 0),
    orchestratorConcurrency: readInt(env.ORCHESTRATOR_CONCURRENCY, 2, 1),
    storageDir: env.STORAGE_DIR ?? './storage',
    thumbnailSize: readInt(env.THUMBNAIL_SIZE, 256, 32),
    tokenSecret: env.JWT_SECRET ?? 'dev-only-change-me-in-production',
    tokenTtlSeconds: readInt(env.TOKEN_TTL_SECONDS, 43_200, 60),
    platformFeeRatio: readFloat(env.PLATFORM_FEE_RATIO, 0.2),
    logLevel: env.LOG_LEVEL ?? 'info',
  };

  return { ...config, ...overrides };
}
