/**
 * ComfyUI HTTP 客户端。
 *
 * 只依赖 fetch（Node 18+ 内置），不引入 axios，便于在 vitest 里注入假 fetch
 * 或直接对本地 http 假服务发真实请求。
 *
 * 错误分类是编排层状态机的基础：
 *   timeout      → 任务置 timeout
 *   unreachable  → 任务置 unreachable（连接被拒 / DNS 失败，典型为"服务未启动"）
 *   http         → 任务置 failed，并保留原始错误体
 *   invalid_response → failed（上游返回了非预期结构）
 */
export type ComfyUiErrorKind = 'timeout' | 'unreachable' | 'http' | 'invalid_response';

export interface ComfyUiErrorInit {
  kind: ComfyUiErrorKind;
  message: string;
  status?: number;
  bodyText?: string;
  nodeErrors?: unknown;
  cause?: unknown;
}

export class ComfyUiError extends Error {
  readonly kind: ComfyUiErrorKind;
  readonly status?: number;
  readonly bodyText?: string;
  readonly nodeErrors?: unknown;

  constructor(init: ComfyUiErrorInit) {
    super(init.message);
    this.name = 'ComfyUiError';
    this.kind = init.kind;
    this.status = init.status;
    this.bodyText = init.bodyText;
    this.nodeErrors = init.nodeErrors;
    if (init.cause) this.cause = init.cause;
  }

  /** 网络抖动 / 5xx 值得重试；4xx 是请求本身有问题，不重试 */
  get retriable(): boolean {
    if (this.kind === 'unreachable' || this.kind === 'timeout') return true;
    if (this.kind === 'http') return (this.status ?? 0) >= 500;
    return false;
  }
}

export interface ComfyHistoryImage {
  filename: string;
  subfolder: string;
  type: string;
}

export interface ComfyHistoryEntry {
  prompt: unknown[];
  outputs: Record<string, { images?: ComfyHistoryImage[] }>;
  status: {
    status_str: string;
    completed: boolean;
    messages?: unknown[];
  };
}

export interface ComfyPromptResponse {
  promptId: string;
  number: number;
  nodeErrors: Record<string, unknown>;
}

export interface ComfyUiClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  /** 便于测试注入（默认 globalThis.fetch） */
  fetchImpl?: typeof fetch;
}

const CONNECT_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function isConnectError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && CONNECT_ERROR_CODES.has(code)) return true;
    const errnoCode = (current as { errno?: unknown }).errno;
    if (typeof errnoCode === 'number' && [111, 61, 11001].includes(errnoCode)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export class ComfyUiClient {
  private baseUrl: string;
  private timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ComfyUiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  get url(): string {
    return this.baseUrl;
  }

  get timeout(): number {
    return this.timeoutMs;
  }

  /** 运行时修改 ComfyUI 地址/超时（设置页保存后立即生效，无需重启） */
  setEndpoint(baseUrl: string, timeoutMs?: number): void {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    if (typeof timeoutMs === 'number' && timeoutMs > 0) this.timeoutMs = timeoutMs;
  }

  /** 统一的请求包装：超时 + 网络错误归类 + 非 2xx 归类 */
  private async request(pathname: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const url = `${this.baseUrl}${pathname}`;
    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        let nodeErrors: unknown;
        try {
          nodeErrors = bodyText ? JSON.parse(bodyText) : undefined;
        } catch {
          nodeErrors = undefined;
        }
        throw new ComfyUiError({
          kind: 'http',
          status: response.status,
          bodyText: bodyText.slice(0, 4000),
          nodeErrors,
          message: `ComfyUI ${init.method ?? 'GET'} ${pathname} 返回 ${response.status}`,
        });
      }
      return response;
    } catch (error) {
      if (error instanceof ComfyUiError) throw error;
      if ((error as Error)?.name === 'AbortError' || (error as Error)?.name === 'TimeoutError') {
        throw new ComfyUiError({
          kind: 'timeout',
          message: `ComfyUI 请求超时（${this.timeoutMs}ms）：${pathname}`,
          cause: error,
        });
      }
      if (isConnectError(error)) {
        throw new ComfyUiError({
          kind: 'unreachable',
          message: `无法连接 ComfyUI 服务 ${this.baseUrl}，请确认服务已启动（${pathname}）`,
          cause: error,
        });
      }
      throw new ComfyUiError({
        kind: 'invalid_response',
        message: `ComfyUI 请求失败：${(error as Error)?.message ?? String(error)}`,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** 提交节点图，返回 prompt_id */
  async submitPrompt(graph: Record<string, unknown>, clientId: string): Promise<ComfyPromptResponse> {
    const response = await this.request('/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: clientId }),
    });

    let payload: {
      prompt_id?: unknown;
      number?: unknown;
      node_errors?: Record<string, unknown>;
    };
    try {
      payload = (await response.json()) as typeof payload;
    } catch (error) {
      throw new ComfyUiError({
        kind: 'invalid_response',
        message: 'POST /prompt 返回的不是合法 JSON',
        cause: error,
      });
    }

    if (typeof payload.prompt_id !== 'string' || payload.prompt_id.length === 0) {
      throw new ComfyUiError({
        kind: 'invalid_response',
        message: 'POST /prompt 响应缺少 prompt_id',
        bodyText: JSON.stringify(payload).slice(0, 2000),
      });
    }

    return {
      promptId: payload.prompt_id,
      number: typeof payload.number === 'number' ? payload.number : 0,
      nodeErrors: payload.node_errors ?? {},
    };
  }

  /** 查询历史；未完成时 ComfyUI 返回 {}，这里归一化为 null */
  async getHistory(promptId: string): Promise<ComfyHistoryEntry | null> {
    const response = await this.request(`/history/${encodeURIComponent(promptId)}`);
    let payload: Record<string, ComfyHistoryEntry>;
    try {
      payload = (await response.json()) as Record<string, ComfyHistoryEntry>;
    } catch (error) {
      throw new ComfyUiError({
        kind: 'invalid_response',
        message: 'GET /history 返回的不是合法 JSON',
        cause: error,
      });
    }

    const entry = payload?.[promptId];
    if (!entry) return null;
    if (typeof entry !== 'object' || !entry.status) {
      throw new ComfyUiError({
        kind: 'invalid_response',
        message: 'GET /history 返回结构缺少 status 字段',
        bodyText: JSON.stringify(entry).slice(0, 2000),
      });
    }
    return entry;
  }

  /** 下载图片字节（/view） */
  async downloadImage(image: ComfyHistoryImage): Promise<{ buffer: Buffer; contentType: string }> {
    const query = new URLSearchParams({
      filename: image.filename,
      subfolder: image.subfolder ?? '',
      type: image.type ?? 'output',
    });
    const response = await this.request(`/view?${query.toString()}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, contentType: response.headers.get('content-type') ?? '' };
  }

  async getQueue(): Promise<{ queue_running: unknown[]; queue_pending: unknown[] }> {
    const response = await this.request('/queue');
    try {
      return (await response.json()) as { queue_running: unknown[]; queue_pending: unknown[] };
    } catch (error) {
      throw new ComfyUiError({ kind: 'invalid_response', message: 'GET /queue 返回非法 JSON', cause: error });
    }
  }

  async getSystemStats(): Promise<{
    system: { comfyui_version?: string; os?: string; python_version?: string };
    devices: Array<{ name?: string; vram_total?: number }>;
  }> {
    const response = await this.request('/system_stats');
    try {
      return (await response.json()) as {
        system: { comfyui_version?: string };
        devices: Array<{ name?: string }>;
      };
    } catch (error) {
      throw new ComfyUiError({ kind: 'invalid_response', message: 'GET /system_stats 返回非法 JSON', cause: error });
    }
  }
}
