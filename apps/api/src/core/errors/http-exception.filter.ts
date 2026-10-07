import { Catch, HttpException, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

import { getRequestId } from '../http/request-context';
import { AppException } from './app.exception';
import { redactDbError } from './db-error';
import { ErrorCode, statusOf } from './error-code';
import {
  constraintNameOf,
  isUniqueViolation,
  mapConstraintToCode,
  raisedErrorCode,
} from './postgres-error';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    requestId?: string;
  };
}

export function flattenZodError(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '(root)';
    fields[path] ??= issue.message;
  }
  return fields;
}

/**
 * 框架內建的 `HttpException`（`ParseUUIDPipe`、找不到路由、guard 回 false…）依狀態碼對應錯誤碼，
 * 前端才不會把一個錯的 id 顯示成「系統錯誤」。
 */
const HTTP_STATUS_TO_CODE: Readonly<Partial<Record<number, ErrorCode>>> = {
  400: 'VALIDATION_FAILED',
  401: 'AUTH_TOKEN_INVALID',
  403: 'AUTHZ_FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

/** 沒列在表裡的 4xx 都是請求本身的問題（例：415、413），一律視為驗證失敗；5xx 才是伺服器錯誤。 */
export function codeOfHttpStatus(status: number): ErrorCode {
  return HTTP_STATUS_TO_CODE[status] ?? (status < 500 ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR');
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = getRequestId();

    if (exception instanceof AppException) {
      // 429／503 帶建議的等待秒數時一併送標準的 Retry-After（限流、AUTH_BUSY、登入的漸進延遲）
      const retryAfter = exception.details?.retryAfterSeconds;
      if (typeof retryAfter === 'number' && retryAfter > 0 && !res.headersSent) {
        res.setHeader('Retry-After', String(Math.ceil(retryAfter)));
      }
      this.send(res, statusOf(exception.code), {
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
          requestId,
        },
      });
      return;
    }

    if (exception instanceof ZodError) {
      this.send(res, 400, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed',
          details: { fields: flattenZodError(exception) },
          requestId,
        },
      });
      return;
    }

    // Postgres 唯一鍵衝突：競態下 service 的預檢查沒擋住
    if (isUniqueViolation(exception)) {
      const constraint = constraintNameOf(exception);
      const code = mapConstraintToCode(constraint);
      // 沒對應到業務錯誤碼的約束：記下來，之後可以補進 CONSTRAINT_TO_CODE 或在 service 預先檢查
      if (code === 'CONFLICT') this.logger.warn({ constraint, requestId }, '未對應的唯一鍵衝突');
      this.send(res, code in ErrorCode ? statusOf(code as ErrorCode) : 409, {
        error: { code, message: 'Conflict', requestId },
      });
      return;
    }

    // Trigger 的第二道防線（`RAISE EXCEPTION 'ROLE_SYSTEM_PROTECTED: ...'`）
    const raised = raisedErrorCode(exception);
    if (raised && raised in ErrorCode) {
      const code = raised as ErrorCode;
      this.send(res, statusOf(code), {
        error: { code, message: code, requestId, details: { source: 'database' } },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      this.send(res, status, {
        error: {
          code: codeOfHttpStatus(status),
          message: exception.message,
          requestId,
        },
      });
      return;
    }

    // 未知錯誤：記完整堆疊到日誌，只回 requestId 給客戶端。資料庫的查詢錯誤拿掉參數（docs/conventions/03-backend.md §7）
    this.logger.error({ err: redactDbError(exception), requestId }, 'Unhandled exception');
    this.send(res, 500, {
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId },
    });
  }

  private send(res: Response, status: number, body: ErrorBody): void {
    res.status(status).json(body);
  }
}
