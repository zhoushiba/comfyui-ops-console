/** 统一响应体与参数校验助手 */
import type { ZodType } from 'zod';
import { BadRequestError } from '../lib/errors.js';

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function ok<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

export function parseWith<T>(schema: ZodType<T>, input: unknown, label = '参数'): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestError(
      `${label}校验失败`,
      'VALIDATION_ERROR',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      })),
    );
  }
  return result.data;
}

export function parsePagination(query: unknown): { page: number; pageSize: number } {
  const raw = (query ?? {}) as Record<string, unknown>;
  const page = Math.max(1, Number.parseInt(String(raw.page ?? '1'), 10) || 1);
  const pageSizeRaw = Number.parseInt(String(raw.pageSize ?? '20'), 10) || 20;
  const pageSize = Math.min(100, Math.max(1, pageSizeRaw));
  return { page, pageSize };
}

export function parseBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes'].includes(String(value).toLowerCase());
}

export function parseIds(value: unknown): number[] {
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((item) => Number.parseInt(String(item), 10))
    .filter((item) => Number.isInteger(item) && item > 0);
}

export function parseId(value: unknown, label = 'ID'): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestError(`${label} 必须是正整数`, 'INVALID_ID');
  }
  return parsed;
}
