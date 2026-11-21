/** 任务创建/查询服务：模板渲染、幂等键、入队 */
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { nowIso } from '../db/knex.js';
import { taskNo } from '../lib/utils.js';
import type { AuthUser } from './authService.js';
import type { TemplateService, TemplateParams } from './templateService.js';
import type { TaskOrchestrator } from './orchestrator.js';
import type { TaskFilters, TaskRepository, TaskRow } from '../repositories/taskRepo.js';
import type { ImageRow, ImageRepository } from '../repositories/imageRepo.js';

export interface CreateTaskInput extends TemplateParams {
  templateId: number;
  clientRequestId?: string;
}

export interface TaskDetail {
  task: TaskRow;
  images: ImageRow[];
  attempts: unknown[];
  templateName: string | null;
}

export class TaskService {
  private readonly tasks: TaskRepository;
  private readonly images: ImageRepository;
  private readonly templates: TemplateService;
  private readonly orchestrator: TaskOrchestrator;

  constructor(
    tasks: TaskRepository,
    images: ImageRepository,
    templates: TemplateService,
    orchestrator: TaskOrchestrator,
  ) {
    this.tasks = tasks;
    this.images = images;
    this.templates = templates;
    this.orchestrator = orchestrator;
  }

  /**
   * 创建任务。带 clientRequestId 时保证幂等：
   * 重复提交返回已有任务，不会重复出图、重复计费。
   */
  async create(
    user: AuthUser,
    input: CreateTaskInput,
  ): Promise<{ task: TaskRow; created: boolean }> {
    if (input.clientRequestId) {
      const existing = await this.tasks.findByClientRequestId(user.id, input.clientRequestId);
      if (existing) return { task: existing, created: false };
    }

    const { template, graph, normalized } = await this.templates.render(input.templateId, input);
    const createdAt = nowIso();
    const paramsJson = JSON.stringify({
      ...normalized,
      templateId: template.id,
      templateName: template.name,
      modelName: template.model_name,
    });

    let taskId: number;
    try {
      taskId = await this.tasks.create({
        task_no: taskNo(),
        user_id: user.id,
        agent_id: user.agentId,
        template_id: template.id,
        client_request_id: input.clientRequestId ?? null,
        status: 'queued',
        prompt_text: normalized.prompt.slice(0, 1000),
        negative_prompt: normalized.negativePrompt.slice(0, 1000),
        params_json: paramsJson,
        graph_json: JSON.stringify(graph),
        progress: 0,
        attempts: 0,
        image_count: 0,
        gpu_seconds: 0,
        created_at: createdAt,
      });
    } catch (error) {
      // 并发重复提交：唯一索引兜底，返回先落库的那条
      if (input.clientRequestId) {
        const existing = await this.tasks.findByClientRequestId(user.id, input.clientRequestId);
        if (existing) return { task: existing, created: false };
      }
      throw error;
    }

    const task = (await this.tasks.findById(taskId)) as TaskRow;
    this.orchestrator.enqueue(taskId);
    return { task, created: true };
  }

  async list(filters: TaskFilters, page: number, pageSize: number): Promise<{ items: unknown[]; total: number; page: number; pageSize: number }> {
    const { items, total } = await this.tasks.list(filters, page, pageSize);
    return { items, total, page, pageSize };
  }

  async detail(id: number): Promise<TaskDetail> {
    const task = await this.tasks.findById(id);
    if (!task) throw new NotFoundError(`任务 #${id} 不存在`);
    const [images, attempts] = await Promise.all([this.images.listByTask(id), this.tasks.listAttempts(id)]);
    let templateName: string | null = null;
    if (task.template_id) {
      const template = await this.templates.getOrThrow(task.template_id).catch(() => null);
      templateName = template?.name ?? null;
    }
    return { task, images, attempts, templateName };
  }

  /** 失败任务重试：仅允许终态失败的任务重新入队 */
  async retry(id: number): Promise<TaskRow> {
    const task = await this.tasks.findById(id);
    if (!task) throw new NotFoundError(`任务 #${id} 不存在`);
    if (!['failed', 'timeout', 'unreachable'].includes(task.status)) {
      throw new ConflictError(`任务当前状态为 ${task.status}，只有失败任务可以重试`, 'TASK_NOT_RETRYABLE');
    }
    await this.tasks.update(id, {
      status: 'queued',
      progress: 0,
      error_code: null,
      error_message: null,
      error_detail: null,
      comfyui_prompt_id: null,
      finished_at: null,
      duration_ms: null,
    });
    this.orchestrator.enqueue(id);
    return (await this.tasks.findById(id)) as TaskRow;
  }
}
