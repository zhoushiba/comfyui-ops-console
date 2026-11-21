/** 统一业务异常：状态码 + 机器可读错误码 + 细节 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, code = 'BAD_REQUEST', details?: unknown) {
    super(400, code, message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = '登录已过期或未登录', code = 'UNAUTHORIZED') {
    super(401, code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = '没有权限执行该操作', code = 'FORBIDDEN') {
    super(403, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = '资源不存在', code = 'NOT_FOUND') {
    super(404, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT', details?: unknown) {
    super(409, code, message, details);
  }
}

export class UnprocessableError extends AppError {
  constructor(message: string, code = 'UNPROCESSABLE', details?: unknown) {
    super(422, code, message, details);
  }
}
