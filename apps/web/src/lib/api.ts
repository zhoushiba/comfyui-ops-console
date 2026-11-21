/**
 * 统一 API 客户端。
 * - 自动附加 Bearer 令牌；401 时清理会话并跳回登录页
 * - 解包后端统一响应体 { success, data } / { success:false, error }
 * - 图片/文件地址通过 fileUrl() 附加 ?token=，供 <img>、<a download> 直接使用
 */
import type {
  AgentDetail,
  AgentSummary,
  ConnectionTest,
  Overview,
  Paginated,
  PlatformSettings,
  SettingsPayload,
  Settlement,
  SettlementDetail,
  SettlementPreview,
  SystemStatus,
  Task,
  TaskDetail,
  Template,
  UsageRecordRow,
  UsageStats,
} from '../types';

const TOKEN_KEY = 'comfyui-ops.token';

/** 构建时注入；Electron 下为 http://127.0.0.1:3000，Web 开发态为空（走 Vite 代理） */
export const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').replace(/\/$/, '');

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: unknown };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const token = getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '无法连接后端服务，请确认 apps/server 已启动');
  }

  const text = await response.text();
  let payload: Envelope<T> | null = null;
  if (text) {
    try {
      payload = JSON.parse(text) as Envelope<T>;
    } catch {
      payload = null;
    }
  }

  if (response.status === 401) {
    clearToken();
    if (!location.hash.startsWith('#/login')) {
      location.hash = '#/login';
    }
  }

  if (!response.ok || payload?.success === false) {
    const error = payload?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'HTTP_ERROR',
      error?.message ?? `请求失败（HTTP ${response.status}）`,
      error?.details,
    );
  }

  return (payload?.data ?? (payload as unknown)) as T;
}

function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** 把 /api/images/... 转成可直接放进 src 的地址（带令牌） */
export function fileUrl(path: string): string {
  const token = getToken();
  if (!token) return `${API_BASE}${path}`;
  return `${API_BASE}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

function filenameFrom(response: Response, fallback: string): string {
  const explicit = response.headers.get('x-export-filename');
  if (explicit) return explicit;
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  return match?.[1] ?? fallback;
}

/**
 * 下载文件并报告进度。CSV 是流式响应（无 Content-Length），
 * 此时 total 为 0，调用方展示"已下载 N KB"的确定进度文案。
 */
export async function downloadFile(
  path: string,
  fallbackName: string,
  onProgress?: (received: number, total: number) => void,
): Promise<string> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);

  const response = await fetch(`${API_BASE}${path}`, { headers });
  if (!response.ok) {
    const text = await response.text();
    let message = `下载失败（HTTP ${response.status}）`;
    try {
      const parsed = JSON.parse(text) as Envelope<unknown>;
      message = parsed.error?.message ?? message;
    } catch {
      /* 保留默认文案 */
    }
    throw new ApiError(response.status, 'EXPORT_FAILED', message);
  }

  const total = Number(response.headers.get('content-length') ?? 0);
  const chunks: Uint8Array[] = [];
  let received = 0;

  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        onProgress?.(received, total);
      }
    }
  } else {
    const buffer = await response.arrayBuffer();
    chunks.push(new Uint8Array(buffer));
    received = buffer.byteLength;
    onProgress?.(received, total);
  }

  const filename = filenameFrom(response, fallbackName);
  const blob = new Blob(chunks as BlobPart[], { type: response.headers.get('content-type') ?? 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

export const api = {
  async login(email: string, password: string) {
    return request<{ token: string; expiresAt: string; user: import('../types').AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  async me() {
    return request<{ user: import('../types').AuthUser }>('/api/auth/me');
  },

  overview() {
    return request<Overview>('/api/overview');
  },

  templates() {
    return request<{ items: Template[] }>('/api/templates');
  },

  tasks: {
    list(params: {
      page?: number;
      pageSize?: number;
      status?: string;
      keyword?: string;
      from?: string;
      to?: string;
      agentId?: number;
    }) {
      return request<Paginated<Task>>(`/api/tasks${query(params)}`);
    },
    detail(id: number) {
      return request<TaskDetail>(`/api/tasks/${id}`);
    },
    create(payload: {
      templateId: number;
      prompt: string;
      negativePrompt?: string;
      seed?: number;
      steps?: number;
      cfg?: number;
      width?: number;
      height?: number;
      batchSize?: number;
      clientRequestId?: string;
    }) {
      return request<{ task: Task; created: boolean }>('/api/tasks', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    retry(id: number) {
      return request<{ task: Task }>(`/api/tasks/${id}/retry`, { method: 'POST' });
    },
  },

  images: {
    list(params: { page?: number; pageSize?: number; format?: string; taskId?: number }) {
      return request<Paginated<import('../types').TaskImage>>(`/api/images${query(params)}`);
    },
    convert(id: number, format: string, quality?: number) {
      return request<import('../types').TaskImage>(`/api/images/${id}/convert`, {
        method: 'POST',
        body: JSON.stringify({ format, quality }),
      });
    },
    batchConvert(ids: number[], format: string, quality?: number) {
      return request<{
        converted: import('../types').TaskImage[];
        failed: Array<{ id: number; message: string }>;
      }>('/api/images/batch-convert', {
        method: 'POST',
        body: JSON.stringify({ ids, format, quality }),
      });
    },
    async download(id: number, filename: string) {
      return downloadFile(`/api/images/${id}/download`, filename);
    },
  },

  usage: {
    stats(params: { from?: string; to?: string; agentId?: number; userId?: number; status?: string }) {
      return request<UsageStats>(`/api/usage/stats${query(params)}`);
    },
    records(params: { page?: number; pageSize?: number; from?: string; to?: string; agentId?: number; status?: string }) {
      return request<Paginated<UsageRecordRow>>(`/api/usage/records${query(params)}`);
    },
    exportCsv(
      params: { from?: string; to?: string; agentId?: number; status?: string },
      onProgress?: (received: number, total: number) => void,
    ) {
      return downloadFile(`/api/export/usage.csv${query(params)}`, 'usage.csv', onProgress);
    },
  },

  agents: {
    list() {
      return request<{ items: AgentSummary[] }>('/api/agents');
    },
    detail(id: number) {
      return request<AgentDetail>(`/api/agents/${id}`);
    },
    preview(id: number, from: string, to: string) {
      return request<SettlementPreview>(`/api/agents/${id}/settlement-preview${query({ from, to })}`);
    },
  },

  settlements: {
    list(params: { page?: number; pageSize?: number; agentId?: number; status?: string }) {
      return request<Paginated<Settlement>>(`/api/settlements${query(params)}`);
    },
    detail(id: number) {
      return request<SettlementDetail>(`/api/settlements/${id}`);
    },
    create(agentId: number, periodStart: string, periodEnd: string) {
      return request<{ id: number; settlementNo: string }>('/api/settlements', {
        method: 'POST',
        body: JSON.stringify({ agentId, periodStart, periodEnd }),
      });
    },
    confirm(id: number) {
      return request<{ settlement: Settlement }>(`/api/settlements/${id}/confirm`, { method: 'POST' });
    },
    pay(id: number) {
      return request<{ settlement: Settlement }>(`/api/settlements/${id}/pay`, { method: 'POST' });
    },
    exportCsv(params: { agentId?: number; status?: string }, onProgress?: (received: number, total: number) => void) {
      return downloadFile(`/api/export/settlements.csv${query(params)}`, 'settlements.csv', onProgress);
    },
  },

  settings: {
    get() {
      return request<SettingsPayload>('/api/settings');
    },
    update(values: Partial<PlatformSettings>) {
      return request<{ settings: PlatformSettings }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(values),
      });
    },
    test() {
      return request<ConnectionTest>('/api/settings/test', { method: 'POST' });
    },
  },

  system: {
    status() {
      return request<SystemStatus>('/api/system/status');
    },
    auditLogs(limit = 30) {
      return request<{ items: Array<Record<string, unknown>> }>(`/api/system/audit-logs${query({ limit })}`);
    },
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return '未知错误';
}
