import type { ErrorCode } from './error-code';

/**
 * Service 層一律拋這個，不拋 HttpException——狀態碼的對應是
 * `HttpExceptionFilter` 的事，service 不該知道 HTTP。
 */
export class AppException extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly details?: Record<string, unknown>,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'AppException';
  }
}
