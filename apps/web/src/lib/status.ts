/** 任务状态 → 中文文案 / 视觉色调 / 是否终态 */
import { TERMINAL_STATUSES, type TaskStatus } from '../types';

export const STATUS_LABELS: Record<TaskStatus, string> = {
  queued: '排队中',
  submitted: '已提交',
  running: '执行中',
  polling: '轮询中',
  downloading: '下载中',
  completed: '已完成',
  failed: '失败',
  timeout: '超时',
  unreachable: '服务不可达',
};

export type StatusTone = 'neutral' | 'info' | 'warn' | 'success' | 'danger' | 'muted';

export const STATUS_TONES: Record<TaskStatus, StatusTone> = {
  queued: 'muted',
  submitted: 'info',
  running: 'info',
  polling: 'info',
  downloading: 'warn',
  completed: 'success',
  failed: 'danger',
  timeout: 'danger',
  unreachable: 'danger',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as TaskStatus] ?? status;
}

export function statusTone(status: string): StatusTone {
  return STATUS_TONES[status as TaskStatus] ?? 'neutral';
}

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.includes(status as TaskStatus);
}

export const ALL_STATUSES = Object.keys(STATUS_LABELS) as TaskStatus[];
