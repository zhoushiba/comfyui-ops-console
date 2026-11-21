/**
 * 种子数据：默认账号、演示代理商、两个提示词模板、定价规则。
 * 幂等：按唯一键判断是否已存在，可反复执行。
 */
import { hashPassword } from '../lib/password.js';
import { nowIso } from './knex.js';
import type { Db } from './knex.js';

export const DEFAULT_PASSWORD = 'Admin@123456';

export interface SeedAccount {
  email: string;
  password: string;
  name: string;
  role: 'admin' | 'operator' | 'agent' | 'user';
}

export const SEED_ACCOUNTS: SeedAccount[] = [
  { email: 'admin@ops.local', password: DEFAULT_PASSWORD, name: '平台管理员', role: 'admin' },
  { email: 'operator@ops.local', password: 'Ops@123456', name: '运营同学', role: 'operator' },
  { email: 'studio@ops.local', password: 'Studio@123456', name: '星野视觉', role: 'agent' },
  { email: 'creator@ops.local', password: 'Creator@123456', name: '创作者小林', role: 'user' },
];

/** 构造一份可通过 ComfyUI 校验的节点图（sd_xl 基础出图链路） */
function buildGraph(promptText: string, negativeText: string): Record<string, unknown> {
  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' },
      _meta: { title: '加载模型' },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: promptText, clip: ['1', 1] },
      _meta: { title: '正向提示词' },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: negativeText, clip: ['1', 1] },
      _meta: { title: '负向提示词' },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width: 512, height: 512, batch_size: 1 },
      _meta: { title: '空白潜空间' },
    },
    '4': {
      class_type: 'KSampler',
      inputs: {
        seed: 42,
        steps: 24,
        cfg: 7.5,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['5', 0],
      },
      _meta: { title: '采样器' },
    },
    '6': {
      class_type: 'VAEDecode',
      inputs: { samples: ['4', 0], vae: ['1', 2] },
      _meta: { title: '解码' },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { images: ['6', 0], filename_prefix: 'ops' },
      _meta: { title: '保存图片' },
    },
  };
}

export const SEED_TEMPLATES = [
  {
    name: 'SDXL 基础出图',
    description: '最常用的一条链路：SDXL 底模 + 24 步采样，适合验证编排链路是否通畅。',
    model_name: 'sd_xl_base_1.0',
    graph_json: JSON.stringify(buildGraph('a cat sitting on a windowsill, morning light', 'blurry, low quality')),
    default_params_json: JSON.stringify({
      mapping: { promptNode: '2', negativeNode: '3', samplerNode: '4', latentNode: '5' },
      defaults: { steps: 24, cfg: 7.5, width: 512, height: 512, batchSize: 1, seed: 42 },
      model: 'sd_xl_base_1.0',
    }),
  },
  {
    name: '国风插画（8 步加速）',
    description: '演示不同参数：更低的步数、更窄的画幅，用于对比耗时与用量统计。',
    model_name: 'dreamshaper_8',
    graph_json: JSON.stringify(buildGraph('chinese ink painting, mountains and cranes', 'watermark, text')),
    default_params_json: JSON.stringify({
      mapping: { promptNode: '2', negativeNode: '3', samplerNode: '4', latentNode: '5' },
      defaults: { steps: 8, cfg: 6.5, width: 768, height: 512, batchSize: 1, seed: 20240101 },
      model: 'dreamshaper_8',
    }),
  },
];

export async function seedDatabase(db: Db): Promise<{ users: number; templates: number; agents: number }> {
  let agentId = (await db('agent').where({ code: 'XY' }).first())?.id as number | undefined;
  if (!agentId) {
    const inserted = await db('agent').insert({
      name: '星野视觉工作室',
      code: 'XY',
      contact_name: '周仕达',
      contact_phone: '13800001111',
      share_ratio: 0.7,
      status: 'active',
      created_at: nowIso(),
    });
    agentId = Number(inserted[0]);
  }

  let users = 0;
  for (const account of SEED_ACCOUNTS) {
    const existing = await db('user').where({ email: account.email }).first();
    if (existing) continue;
    const userId = await db('user').insert({
      email: account.email,
      name: account.name,
      password_hash: hashPassword(account.password),
      role: account.role,
      agent_id: account.role === 'agent' || account.role === 'user' ? agentId : null,
      status: 'active',
      created_at: nowIso(),
    });
    users += 1;
    if (account.role === 'agent' || account.role === 'user') {
      await db('agent_user').insert({
        agent_id: agentId,
        user_id: Number(userId[0]),
        joined_at: nowIso(),
      });
    }
  }

  let templates = 0;
  for (const template of SEED_TEMPLATES) {
    const existing = await db('prompt_template').where({ name: template.name }).first();
    if (existing) continue;
    await db('prompt_template').insert({
      ...template,
      is_active: true,
      created_by: 1,
      created_at: nowIso(),
    });
    templates += 1;
  }

  const rule = await db('pricing_rule').where({ agent_id: agentId }).first();
  if (!rule) {
    await db('pricing_rule').insert({
      agent_id: agentId,
      model_name: 'sd_xl_base_1.0',
      base_price_cents: 120,
      tier_threshold: 1000,
      tier2_price_cents: 100,
      share_ratio: 0.7,
      effective_from: '2024-01-01',
      created_at: nowIso(),
    });
  }

  const defaults: Record<string, string> = {
    comfyuiBaseUrl: process.env.COMFYUI_BASE_URL ?? 'http://127.0.0.1:8188',
    comfyuiRequestTimeoutMs: '10000',
    comfyuiPollIntervalMs: '800',
    comfyuiJobTimeoutMs: '60000',
    orchestratorConcurrency: '2',
    thumbnailSize: '256',
  };
  for (const [key, value] of Object.entries(defaults)) {
    const exists = await db('system_config').where({ key }).first();
    if (!exists) {
      await db('system_config').insert({ key, value, updated_at: nowIso() });
    }
  }

  return { users, templates, agents: 1 };
}
