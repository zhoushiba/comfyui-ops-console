/** DTO 转换：对外不返回 graph_json 等大字段，统一转 camelCase 供前端消费 */
import type { ImageRow } from '../repositories/imageRepo.js';
import type { TaskRow } from '../repositories/taskRepo.js';

export interface TaskDto {
  id: number;
  taskNo: string;
  userId: number;
  agentId: number | null;
  templateId: number | null;
  clientRequestId: string | null;
  status: string;
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

export function toTaskDto(task: TaskRow): TaskDto {
  let params: Record<string, unknown> = {};
  try {
    params = JSON.parse(task.params_json ?? '{}') as Record<string, unknown>;
  } catch {
    params = {};
  }
  return {
    id: task.id,
    taskNo: task.task_no,
    userId: task.user_id,
    agentId: task.agent_id,
    templateId: task.template_id,
    clientRequestId: task.client_request_id,
    status: task.status,
    prompt: task.prompt_text,
    promptPreview: task.prompt_text.length > 120 ? `${task.prompt_text.slice(0, 120)}…` : task.prompt_text,
    negativePrompt: task.negative_prompt,
    params,
    comfyuiPromptId: task.comfyui_prompt_id,
    progress: task.progress,
    errorCode: task.error_code,
    errorMessage: task.error_message,
    errorDetail: task.error_detail,
    attempts: task.attempts,
    submittedAt: task.submitted_at,
    startedAt: task.started_at,
    finishedAt: task.finished_at,
    durationMs: task.duration_ms,
    imageCount: task.image_count,
    gpuSeconds: task.gpu_seconds,
    createdAt: task.created_at,
  };
}

export interface ImageDto {
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

export function toImageDto(image: ImageRow): ImageDto {
  return {
    id: image.id,
    taskId: image.task_id,
    userId: image.user_id,
    agentId: image.agent_id,
    filename: image.filename,
    format: image.format,
    mimeType: image.mime_type,
    width: image.width ?? 0,
    height: image.height ?? 0,
    byteSize: image.byte_size,
    sourceImageId: image.source_image_id,
    createdAt: image.created_at,
    url: `/api/images/${image.id}/file`,
    thumbnailUrl: `/api/images/${image.id}/thumbnail`,
    downloadUrl: `/api/images/${image.id}/download`,
  };
}
