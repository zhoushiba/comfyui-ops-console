/** 与后端约定的数据结构（与 apps/server/src/http/dto.ts 保持一致） */

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

export const TERMINAL_STATUSES: TaskStatus[] = ['completed', 'failed', 'timeout', 'unreachable'];

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'operator' | 'agent' | 'user' | string;
  agentId: number | null;
  agentName: string | null;
}

export interface Task {
  id: number;
  taskNo: string;
  userId: number;
  agentId: number | null;
  templateId: number | null;
  clientRequestId: string | null;
  status: TaskStatus;
  prompt: string;
  promptPreview: string;
  negativePrompt: string | null;
  params: Record<string, unknown>;
  comfyuiPromptId: string | null;
  progress: number;
  errorCode: string | null;
  errorMessage: string | null;
  errorDetail: string | null;
  attempts: number;
  submittedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  imageCount: number;
  gpuSeconds: number;
  createdAt: string;
}

export interface TaskImage {
  id: number;
  taskId: number;
  userId: number;
  agentId: number | null;
  filename: string;
  format: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  sourceImageId: number | null;
  createdAt: string;
  url: string;
  thumbnailUrl: string;
  downloadUrl: string;
}

export interface TaskAttempt {
  id: number;
  task_id: number;
  attempt_no: number;
  status: string;
  stage: string | null;
  http_status: number | null;
  error_type: string | null;
  error_message: string | null;
  backoff_ms: number | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface TaskDetail {
  task: Task;
  templateName: string | null;
  images: TaskImage[];
  attempts: TaskAttempt[];
}

export interface Template {
  id: number;
  name: string;
  description: string | null;
  model_name: string;
  is_active: boolean | number;
  created_at: string;
  defaults: {
    model?: string;
    mapping?: Record<string, string>;
    defaults?: Record<string, unknown>;
  } | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TrendPoint {
  date: string;
  tasks: number;
  images: number;
}

export interface UsageTotals {
  tasks: number;
  images: number;
  gpuSeconds: number;
  succeeded: number;
  failed: number;
  billableImages: number;
}

export interface UsageStats {
  filters: { from?: string; to?: string };
  totals: UsageTotals;
  successRate: number;
  failureRate: number;
  p50DurationMs: number;
  p95DurationMs: number;
  avgDurationMs: number;
  avgGpuSeconds: number;
  trend: TrendPoint[];
  byAgent: Array<{ agentId: number | null; agentName: string; tasks: number; images: number }>;
  byUser: Array<{ userId: number | null; userName: string; tasks: number; images: number }>;
}

/** 用量明细：后端直接用 usage_record 表的 snake_case 字段与 join 别名 */
export interface UsageRecordRow {
  id: number;
  task_id: number;
  user_id: number;
  agent_id: number | null;
  task_no: string | null;
  user_name: string | null;
  agent_name: string | null;
  prompt_text: string | null;
  model_name: string;
  status: string;
  image_count: number;
  duration_ms: number | null;
  gpu_seconds: number;
  billable: boolean | number;
  occurred_at: string;
}

export interface OrchestratorStats {
  concurrency: number;
  running: number;
  queued: number;
  completedSinceBoot: number;
  failedSinceBoot: number;
}

export interface Overview {
  generatedAt: string;
  today: { tasks: number; images: number; gpuSeconds: number };
  month: { tasks: number; images: number; gpuSeconds: number; successRate: number };
  statusCounts: Record<string, number>;
  duration: { p50: number; p95: number; avg: number };
  recentTasks: Task[];
  trend: TrendPoint[];
  agents: Array<{ agentId: number | null; agentName: string; tasks: number; images: number }>;
  queue: OrchestratorStats;
  imageTotal: number;
  failureReasons: Array<{ code: string; count: number }>;
}

export interface AgentSummary {
  id: number;
  name: string;
  code: string;
  contactName: string | null;
  contactPhone: string | null;
  shareRatio: number;
  userCount: number;
  monthTasks: number;
  monthImages: number;
}

export interface AgentDetail {
  agent: {
    id: number;
    name: string;
    code: string;
    contactName: string | null;
    contactPhone: string | null;
    shareRatio: number;
    status: string;
  };
  users: Array<{ userId: number; name: string; email: string }>;
  pricingRules: Array<{
    id: number;
    modelName: string;
    basePriceCents: number;
    tierThreshold: number;
    tier2PriceCents: number;
    shareRatio: number;
    effectiveFrom: string;
  }>;
}

export interface SettlementPreview {
  agentId: number;
  agentName: string;
  periodStart: string;
  periodEnd: string;
  taskCount: number;
  imageCount: number;
  userCount: number;
  rule: {
    id: number;
    modelName: string;
    basePriceCents: number;
    tierThreshold: number;
    tier2PriceCents: number;
    shareRatio: number;
    effectiveFrom: string;
  };
  amount: {
    imageCount: number;
    grossCents: number;
    platformFeeCents: number;
    agentAmountCents: number;
    shareRatio: number;
    tiers: Array<{ label: string; imageCount: number; unitPriceCents: number; amountCents: number }>;
  };
  users: Array<{ userId: number; userName: string; tasks: number; images: number }>;
  items: Array<{ description: string; imageCount: number; unitPriceCents: number; amountCents: number }>;
  existingSettlementId: number | null;
}

export interface Settlement {
  id: number;
  settlement_no: string;
  agent_id: number;
  agent_name?: string;
  agent_code?: string;
  period_start: string;
  period_end: string;
  status: 'pending' | 'confirmed' | 'paid';
  task_count: number;
  image_count: number;
  gross_cents: number;
  platform_fee_cents: number;
  agent_amount_cents: number;
  confirmed_at: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface SettlementDetail {
  settlement: Settlement;
  items: Array<{
    id: number;
    description: string;
    image_count: number;
    unit_price_cents: number;
    amount_cents: number;
  }>;
}

export interface PlatformSettings {
  comfyuiBaseUrl: string;
  comfyuiRequestTimeoutMs: number;
  comfyuiPollIntervalMs: number;
  comfyuiJobTimeoutMs: number;
  orchestratorConcurrency: number;
  thumbnailSize: number;
}

export interface SettingsPayload {
  settings: PlatformSettings;
  storageDir: string;
  dbClient: string;
  version: string;
}

export interface ConnectionTest {
  reachable: boolean;
  latencyMs: number;
  version?: string;
  pythonVersion?: string;
  devices?: Array<{ name?: string; type?: string; vram_total?: number }>;
  errorKind?: string;
  status?: number;
  message?: string;
}

export interface SystemStatus {
  db: 'ok' | 'error';
  comfyui: {
    reachable: boolean;
    latencyMs: number;
    version?: string;
    devices?: unknown[];
    errorKind?: string;
    message?: string;
  };
  orchestrator: OrchestratorStats;
  queue: { running: number; queued: number };
  uptimeSeconds: number;
  nodeVersion: string;
  generatedAt: string;
}
