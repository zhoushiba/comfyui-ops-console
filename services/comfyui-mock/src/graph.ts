/**
 * 节点图校验：尽量贴近真实 ComfyUI 的 /prompt 校验行为。
 * 真实服务返回 400 + node_errors，我们保持同样的字段与语义，
 * 这样编排层"400 → failed 并记录原始错误体"的逻辑才有真实输入。
 */

export interface PromptNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}

export interface PromptGraph {
  [nodeId: string]: PromptNode;
}

export interface NodeErrorDetail {
  type: string;
  message: string;
  details: string;
  extra_info: Record<string, unknown>;
}

export interface NodeErrorEntry {
  errors: NodeErrorDetail[];
  dependent_outputs: string[];
  class_type: string;
}

export interface ValidationResult {
  ok: boolean;
  nodeErrors: Record<string, NodeErrorEntry>;
  outputNodeIds: string[];
}

/** 各节点类型的必填输入，与 object_info 中的 required 保持一致 */
const REQUIRED_INPUTS: Record<string, string[]> = {
  CheckpointLoaderSimple: ['ckpt_name'],
  CLIPTextEncode: ['text', 'clip'],
  KSampler: ['seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise', 'model', 'positive', 'negative', 'latent_image'],
  VAEDecode: ['samples', 'vae'],
  EmptyLatentImage: ['width', 'height', 'batch_size'],
  SaveImage: ['images'],
};

/** 输出节点：只有输出节点才会被 outputs_to_execute 收集 */
const OUTPUT_NODE_TYPES = new Set(['SaveImage', 'PreviewImage']);

function missingInputError(inputName: string): NodeErrorDetail {
  return {
    type: 'required_input_missing',
    message: 'Required input is missing',
    details: inputName,
    extra_info: {},
  };
}

function badLinkError(nodeId: string): NodeErrorDetail {
  return {
    type: 'bad_linked_input',
    message: 'Bad linked input',
    details: `Node ${nodeId} referenced by a link does not exist`,
    extra_info: {},
  };
}

/** 节点输入里的连线形如 ["4", 0]，返回被引用的节点 id */
function linkedNodeId(value: unknown): string | null {
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string') {
    return value[0];
  }
  return null;
}

export function validatePromptGraph(rawGraph: unknown): ValidationResult {
  const nodeErrors: Record<string, NodeErrorEntry> = {};
  const outputNodeIds: string[] = [];

  if (!rawGraph || typeof rawGraph !== 'object' || Array.isArray(rawGraph)) {
    return {
      ok: false,
      nodeErrors: {
        '0': {
          errors: [
            {
              type: 'invalid_prompt',
              message: 'Prompt must be an object keyed by node id',
              details: 'prompt',
              extra_info: {},
            },
          ],
          dependent_outputs: [],
          class_type: 'unknown',
        },
      },
      outputNodeIds: [],
    };
  }

  const graph = rawGraph as PromptGraph;
  const nodeIds = Object.keys(graph);

  if (nodeIds.length === 0) {
    return {
      ok: false,
      nodeErrors: {
        '0': {
          errors: [
            {
              type: 'invalid_prompt',
              message: 'Prompt graph is empty',
              details: 'prompt',
              extra_info: {},
            },
          ],
          dependent_outputs: [],
          class_type: 'unknown',
        },
      },
      outputNodeIds: [],
    };
  }

  for (const [nodeId, node] of Object.entries(graph)) {
    const errors: NodeErrorDetail[] = [];
    const classType = node && typeof node === 'object' ? node.class_type : undefined;

    if (typeof classType !== 'string' || classType.length === 0) {
      errors.push({
        type: 'invalid_node',
        message: 'Node is missing class_type',
        details: 'class_type',
        extra_info: {},
      });
      nodeErrors[nodeId] = { errors, dependent_outputs: [], class_type: String(classType ?? 'unknown') };
      continue;
    }

    if (!node.inputs || typeof node.inputs !== 'object' || Array.isArray(node.inputs)) {
      errors.push({
        type: 'invalid_node',
        message: 'Node inputs must be an object',
        details: 'inputs',
        extra_info: {},
      });
    } else {
      const required = REQUIRED_INPUTS[classType];
      if (required) {
        for (const inputName of required) {
          if (node.inputs[inputName] === undefined) {
            errors.push(missingInputError(inputName));
          }
        }
      }
      // 连线引用的节点必须存在
      for (const value of Object.values(node.inputs)) {
        const linked = linkedNodeId(value);
        if (linked && !graph[linked]) {
          errors.push(badLinkError(linked));
        }
      }
    }

    if (OUTPUT_NODE_TYPES.has(classType)) {
      outputNodeIds.push(nodeId);
    }

    if (errors.length > 0) {
      nodeErrors[nodeId] = { errors, dependent_outputs: [], class_type: classType };
    }
  }

  // 没有输出节点时真实 ComfyUI 报 "Prompt has no outputs"
  if (outputNodeIds.length === 0 && Object.keys(nodeErrors).length === 0) {
    nodeErrors['0'] = {
      errors: [
        {
          type: 'prompt_no_outputs',
          message: 'Prompt has no outputs',
          details: '',
          extra_info: {},
        },
      ],
      dependent_outputs: [],
      class_type: 'unknown',
    };
  }

  return { ok: Object.keys(nodeErrors).length === 0, nodeErrors, outputNodeIds };
}

/** 生成和真实 ComfyUI 一致的 400 错误体 */
export function buildValidationErrorBody(nodeErrors: Record<string, NodeErrorEntry>) {
  const firstNode = Object.values(nodeErrors)[0];
  const detail = firstNode?.errors[0]?.details ?? '';
  return {
    error: {
      type: 'prompt_outputs_failed_validation',
      message: 'Prompt outputs failed validation',
      details: detail,
      extra_info: {},
    },
    node_errors: nodeErrors,
  };
}
