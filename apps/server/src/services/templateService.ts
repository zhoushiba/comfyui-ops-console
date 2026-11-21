/**
 * 提示词模板：把"模板节点图 + 映射"渲染成一次真实提交的节点图。
 *
 * 设计：模板里保存完整 ComfyUI 节点图，default_params_json 保存
 *   { mapping: { promptNode, negativeNode, samplerNode, latentNode }, defaults: {...} }
 * 渲染时只改写映射到的节点输入，其余节点（checkpoint、vae 等）保持不变。
 */
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import type { AccountRepository, TemplateRow } from '../repositories/accountRepo.js';

export interface TemplateMapping {
  promptNode: string;
  negativeNode?: string;
  samplerNode?: string;
  latentNode?: string;
}

export interface TemplateParams {
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  steps?: number;
  cfg?: number;
  width?: number;
  height?: number;
  batchSize?: number;
}

export interface TemplateMeta {
  mapping: TemplateMapping;
  defaults?: Partial<TemplateParams>;
  model?: string;
}

export interface RenderedTemplate {
  graph: Record<string, unknown>;
  params: Required<Pick<TemplateParams, 'seed' | 'steps' | 'cfg' | 'width' | 'height' | 'batchSize'>> & {
    prompt: string;
    negativePrompt: string;
  };
}

export function parseTemplateMeta(template: TemplateRow): TemplateMeta {
  try {
    const parsed = JSON.parse(template.default_params_json ?? '{}') as TemplateMeta;
    if (!parsed.mapping?.promptNode) {
      throw new Error('缺少 mapping.promptNode');
    }
    return parsed;
  } catch (error) {
    throw new BadRequestError(`模板 #${template.id} 参数定义损坏：${(error as Error).message}`, 'TEMPLATE_BROKEN');
  }
}

/** 深拷贝后按映射改写参数，避免污染模板缓存 */
export function renderGraph(template: TemplateRow, params: TemplateParams): RenderedTemplate {
  const meta = parseTemplateMeta(template);
  const graph = JSON.parse(template.graph_json) as Record<string, { inputs?: Record<string, unknown> }>;
  const defaults = meta.defaults ?? {};

  const merged = {
    prompt: params.prompt,
    negativePrompt: params.negativePrompt ?? defaults.negativePrompt ?? '',
    seed: params.seed ?? defaults.seed ?? 42,
    steps: params.steps ?? defaults.steps ?? 24,
    cfg: params.cfg ?? defaults.cfg ?? 7.5,
    width: params.width ?? defaults.width ?? 512,
    height: params.height ?? defaults.height ?? 512,
    batchSize: params.batchSize ?? defaults.batchSize ?? 1,
  };

  if (!merged.prompt || merged.prompt.trim().length === 0) {
    throw new BadRequestError('提示词不能为空', 'PROMPT_EMPTY');
  }
  if (merged.steps < 1 || merged.steps > 150) {
    throw new BadRequestError('steps 必须在 1~150 之间', 'INVALID_STEPS');
  }
  if (merged.cfg < 0 || merged.cfg > 30) {
    throw new BadRequestError('cfg 必须在 0~30 之间', 'INVALID_CFG');
  }
  if (merged.width < 64 || merged.width > 2048 || merged.height < 64 || merged.height > 2048) {
    throw new BadRequestError('宽高必须在 64~2048 之间', 'INVALID_SIZE');
  }
  if (merged.batchSize < 1 || merged.batchSize > 8) {
    throw new BadRequestError('batchSize 必须在 1~8 之间', 'INVALID_BATCH');
  }

  const setInput = (nodeId: string | undefined, input: Record<string, unknown>, label: string): void => {
    if (!nodeId) return;
    const node = graph[nodeId];
    if (!node) throw new BadRequestError(`模板映射的${label}节点 ${nodeId} 不存在`, 'TEMPLATE_MAPPING_MISSING');
    node.inputs = { ...(node.inputs ?? {}), ...input };
  };

  setInput(meta.mapping.promptNode, { text: merged.prompt }, '正向提示词');
  setInput(meta.mapping.negativeNode, { text: merged.negativePrompt }, '负向提示词');
  setInput(
    meta.mapping.samplerNode,
    { seed: merged.seed, steps: merged.steps, cfg: merged.cfg },
    '采样',
  );
  setInput(
    meta.mapping.latentNode,
    { width: merged.width, height: merged.height, batch_size: merged.batchSize },
    '尺寸',
  );

  return { graph, params: merged };
}

export class TemplateService {
  private readonly accounts: AccountRepository;

  constructor(accounts: AccountRepository) {
    this.accounts = accounts;
  }

  async list(): Promise<Array<Omit<TemplateRow, 'graph_json' | 'default_params_json'> & { defaults: unknown }>> {
    const rows = await this.accounts.listTemplates(true);
    return rows.map((row) => {
      const { graph_json: _graph, default_params_json: params, ...rest } = row;
      let defaults: unknown = null;
      try {
        defaults = JSON.parse(params ?? '{}');
      } catch {
        defaults = null;
      }
      return { ...rest, defaults };
    });
  }

  async getOrThrow(id: number): Promise<TemplateRow> {
    const template = await this.accounts.findTemplateById(id);
    if (!template) throw new NotFoundError(`模板 #${id} 不存在`);
    return template;
  }

  async render(templateId: number, params: TemplateParams): Promise<{
    template: TemplateRow;
    graph: Record<string, unknown>;
    normalized: RenderedTemplate['params'];
  }> {
    const template = await this.getOrThrow(templateId);
    const rendered = renderGraph(template, params);
    return { template, graph: rendered.graph, normalized: rendered.params };
  }
}
