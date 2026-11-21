/**
 * ComfyUI Mock 服务。
 *
 * 路由与真实 ComfyUI 对齐：
 *   POST /prompt                   提交节点图，返回 { prompt_id, number, node_errors }
 *   GET  /history/{prompt_id}      未完成返回 {}，完成后返回真实结构
 *   GET  /view?filename=&subfolder=&type=   返回真实 PNG 字节
 *   GET  /queue                    queue_running / queue_pending
 *   GET  /system_stats             system.comfyui_version + devices
 *   GET  /object_info              节点定义
 *
 * mock 自身扩展（真实服务没有）：
 *   GET  /health                  健康检查
 *   GET  /mock/progress/{id}      0→100% 进度（真实服务走 WebSocket）
 *   GET  /__admin/state           查看当前故障模式
 *   POST /__admin/mode            切换 ok|slow|fail|partial|dead
 *   POST /__admin/reset           清空任务
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { loadConfig, type MockConfig } from './config.js';
import { buildValidationErrorBody, validatePromptGraph, type PromptGraph } from './graph.js';
import { generatePng } from './png.js';
import { JobStore, type MockJob } from './store.js';

export type FaultMode = 'ok' | 'slow' | 'fail' | 'partial' | 'dead';

export interface MockState {
  mode: FaultMode;
  startedAt: number;
  requests: number;
}

export interface MockApp {
  app: FastifyInstance;
  state: MockState;
  store: JobStore;
  config: MockConfig;
  close: () => Promise<void>;
}

const COMPFYUI_VERSION = '0.3.68-mock';

const OBJECT_INFO = {
  CheckpointLoaderSimple: {
    input: { required: { ckpt_name: [['sd_xl_base_1.0.safetensors', 'v1-5-pruned-emaonly.safetensors']] } },
    input_order: { required: ['ckpt_name'] },
    output: ['MODEL', 'CLIP', 'VAE'],
    output_name: ['MODEL', 'CLIP', 'VAE'],
    output_node: false,
    name: 'CheckpointLoaderSimple',
    display_name: 'Load Checkpoint',
    description: 'Loads a diffusion model checkpoint',
    category: 'loaders',
  },
  CLIPTextEncode: {
    input: {
      required: {
        text: ['STRING', { multiline: true }],
        clip: ['CLIP'],
      },
    },
    input_order: { required: ['text', 'clip'] },
    output: ['CONDITIONING'],
    output_name: ['CONDITIONING'],
    output_node: false,
    name: 'CLIPTextEncode',
    display_name: 'CLIP Text Encode (Prompt)',
    description: 'Encodes a text prompt using a CLIP model',
    category: 'conditioning',
  },
  KSampler: {
    input: {
      required: {
        model: ['MODEL'],
        seed: ['INT', { default: 0, min: 0, max: 18446744073709552000 }],
        steps: ['INT', { default: 20, min: 1, max: 10000 }],
        cfg: ['FLOAT', { default: 8, min: 0, max: 100 }],
        sampler_name: [['euler', 'euler_ancestral', 'dpmpp_2m', 'ddim']],
        scheduler: [['normal', 'karras', 'exponential']],
        positive: ['CONDITIONING'],
        negative: ['CONDITIONING'],
        latent_image: ['LATENT'],
        denoise: ['FLOAT', { default: 1, min: 0, max: 1 }],
      },
    },
    input_order: {
      required: ['model', 'seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'positive', 'negative', 'latent_image', 'denoise'],
    },
    output: ['LATENT'],
    output_name: ['LATENT'],
    output_node: false,
    name: 'KSampler',
    display_name: 'KSampler',
    description: 'Samples latent using a diffusion model',
    category: 'sampling',
  },
  VAEDecode: {
    input: { required: { samples: ['LATENT'], vae: ['VAE'] } },
    input_order: { required: ['samples', 'vae'] },
    output: ['IMAGE'],
    output_name: ['IMAGE'],
    output_node: false,
    name: 'VAEDecode',
    display_name: 'VAE Decode',
    description: 'Decodes latent to image',
    category: 'latent',
  },
  SaveImage: {
    input: {
      required: {
        images: ['IMAGE'],
        filename_prefix: ['STRING', { default: 'ComfyUI' }],
      },
    },
    input_order: { required: ['images', 'filename_prefix'] },
    output: [],
    output_name: [],
    output_node: true,
    name: 'SaveImage',
    display_name: 'Save Image',
    description: 'Saves images to the output directory',
    category: 'image',
  },
} as const;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createMockApp(overrides: Partial<MockConfig> = {}): MockApp {
  const config: MockConfig = { ...loadConfig(), ...overrides };
  const state: MockState = { mode: config.mode, startedAt: Date.now(), requests: 0 };
  const store = new JobStore();
  const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024 });

  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/__admin') || request.url === '/health') return;
    state.requests += 1;
    if (state.mode === 'slow') {
      await delay(config.slowMs);
    }
    if (state.mode === 'fail') {
      void reply.code(500).send({
        error: {
          type: 'internal_error',
          message: 'Mock failure injection: mode=fail',
          details: 'Switch mode with POST /__admin/mode {"mode":"ok"}',
          extra_info: {},
        },
        node_errors: {},
      });
    }
  });

  app.get('/health', async () => ({
    status: 'ok',
    mode: state.mode,
    uptime_seconds: Math.round((Date.now() - state.startedAt) / 1000),
  }));

  app.get('/', async () => ({
    name: 'comfyui-mock',
    comfyui_version: COMPFYUI_VERSION,
    mode: state.mode,
    endpoints: ['/prompt', '/history/{prompt_id}', '/view', '/queue', '/system_stats', '/object_info', '/mock/progress/{prompt_id}'],
  }));

  app.get('/system_stats', async () => ({
    system: {
      os: 'posix',
      ram_total: 68719476736,
      ram_free: 42949672960,
      comfyui_version: COMPFYUI_VERSION,
      python_version: '3.11.9 (mock)',
      pytorch_version: '2.4.0+cu121 (mock)',
      embedded_python: false,
    },
    devices: [
      {
        name: 'cuda:0 NVIDIA GeForce RTX 4090 (mock)',
        type: 'cuda',
        index: 0,
        vram_total: 25757220864,
        vram_free: 23192823398,
        torch_vram_total: 25757220864,
        torch_vram_free: 23192823398,
      },
    ],
  }));

  app.get('/object_info', async () => OBJECT_INFO);

  app.post('/prompt', async (request, reply) => {
    const body = request.body as { prompt?: unknown; client_id?: unknown } | undefined;
    if (!body || typeof body !== 'object' || body.prompt === undefined) {
      return reply.code(400).send(buildValidationErrorBody({
        '0': {
          errors: [
            {
              type: 'invalid_prompt',
              message: 'Request body must contain a prompt graph',
              details: 'prompt',
              extra_info: {},
            },
          ],
          dependent_outputs: [],
          class_type: 'unknown',
        },
      }));
    }

    const validation = validatePromptGraph(body.prompt);
    if (!validation.ok) {
      return reply.code(400).send(buildValidationErrorBody(validation.nodeErrors));
    }

    const job = store.create({
      graph: body.prompt as PromptGraph,
      clientId: typeof body.client_id === 'string' ? body.client_id : '',
      outputNodeIds: validation.outputNodeIds,
      durationMs: config.jobDurationMs,
    });

    return reply.code(200).send({ prompt_id: job.promptId, number: job.number, node_errors: {} });
  });

  app.get('/history/:promptId', async (request, reply) => {
    const { promptId } = request.params as { promptId: string };
    const job = store.get(promptId);
    if (!job) {
      // 真实 ComfyUI 对未知 prompt_id 返回空对象
      return reply.code(200).send({});
    }

    const progress = store.progress(job, state.mode === 'dead' ? 'ok' : state.mode);
    if (progress.status !== 'completed') {
      return reply.code(200).send({});
    }

    return reply.code(200).send({ [promptId]: buildHistoryEntry(job) });
  });

  app.get('/view', async (request, reply) => {
    const query = request.query as { filename?: string; subfolder?: string; type?: string };
    if (!query.filename) {
      return reply.code(400).send({ error: 'filename query parameter is required' });
    }
    const png = generatePng(query.filename, 512);
    // partial 模式：返回被截断的字节，内容类型仍是 image/png，
    // 用于验证编排层的 magic bytes + 完整性校验（而不是盲目相信 content-type）
    const payload = state.mode === 'partial' ? png.subarray(0, 128) : png;
    return reply
      .code(200)
      .header('content-type', 'image/png')
      .header('content-length', String(payload.length))
      .header('x-mock-filename', query.filename)
      .header('x-mock-subfolder', query.subfolder ?? '')
      .header('x-mock-type', query.type ?? 'output')
      .send(payload);
  });

  app.get('/queue', async () => {
    const jobs = store.list();
    const running = jobs
      .filter((job) => store.progress(job, state.mode === 'dead' ? 'ok' : state.mode).status === 'running')
      .map((job) => queueEntry(job));
    return { queue_running: running, queue_pending: [] };
  });

  app.get('/mock/progress/:promptId', async (request, reply) => {
    const { promptId } = request.params as { promptId: string };
    const job = store.get(promptId);
    if (!job) return reply.code(404).send({ error: 'prompt not found' });
    return store.progress(job, state.mode === 'dead' ? 'ok' : state.mode);
  });

  app.get('/__admin/state', async () => ({
    mode: state.mode,
    uptime_seconds: Math.round((Date.now() - state.startedAt) / 1000),
    requests: state.requests,
    jobs: store.count,
  }));

  app.post('/__admin/mode', async (request, reply) => {
    const body = request.body as { mode?: FaultMode } | undefined;
    const mode = body?.mode;
    if (!mode || !['ok', 'slow', 'fail', 'partial', 'dead'].includes(mode)) {
      return reply.code(400).send({ error: 'mode must be one of ok|slow|fail|partial|dead' });
    }
    state.mode = mode;
    // dead：关闭监听端口，让客户端看到真实的 ECONNREFUSED（即"服务未启动"）
    if (mode === 'dead') {
      setTimeout(() => {
        void app.close();
      }, 50);
    }
    return reply.code(200).send({ mode });
  });

  app.post('/__admin/reset', async () => {
    store.clear();
    return { ok: true };
  });

  app.setErrorHandler((error, _request, reply) => {
    const err = error as { statusCode?: number; message?: string };
    void reply.code(err.statusCode ?? 500).send({
      error: {
        type: 'internal_error',
        message: err.message ?? 'internal error',
        details: '',
        extra_info: {},
      },
      node_errors: {},
    });
  });

  const close = async (): Promise<void> => {
    await app.close();
  };

  return { app, state, store, config, close };
}

function queueEntry(job: MockJob): unknown[] {
  return [job.number, job.promptId, job.graph, { client_id: job.clientId }, job.outputNodeIds];
}

function buildHistoryEntry(job: MockJob): Record<string, unknown> {
  const now = Date.now();
  return {
    prompt: [job.number, job.promptId, job.graph, { client_id: job.clientId }, job.outputNodeIds],
    outputs: job.outputs,
    status: {
      status_str: 'success',
      completed: true,
      messages: [
        ['execution_start', { prompt_id: job.promptId, timestamp: job.receivedAt }],
        ['execution_cached', { nodes: [], prompt_id: job.promptId, timestamp: job.receivedAt + 10 }],
        ['execution_success', { prompt_id: job.promptId, timestamp: now }],
      ],
    },
    meta: { mock: true, duration_ms: job.durationMs },
  };
}
