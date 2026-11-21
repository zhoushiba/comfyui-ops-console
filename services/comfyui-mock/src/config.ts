/**
 * Mock 服务配置：全部来自环境变量，默认值可直接跑通联调。
 */
export type MockMode = 'ok' | 'slow' | 'fail' | 'partial';

export interface MockConfig {
  port: number;
  host: string;
  mode: MockMode;
  slowMs: number;
  jobDurationMs: number;
}

const MODES: MockMode[] = ['ok', 'slow', 'fail', 'partial'];

function readMode(value: string | undefined): MockMode {
  return MODES.includes(value as MockMode) ? (value as MockMode) : 'ok';
}

function readInt(value: string | undefined, fallback: number, min = 0): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MockConfig {
  return {
    port: readInt(env.MOCK_PORT, 8188, 1),
    host: env.MOCK_HOST ?? '127.0.0.1',
    mode: readMode(env.MOCK_MODE),
    slowMs: readInt(env.MOCK_SLOW_MS, 5000),
    jobDurationMs: readInt(env.MOCK_JOB_DURATION_MS, 3000, 100),
  };
}
