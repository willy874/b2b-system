import { Catch, HttpException, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

import { getRequestId } from '../http/request-context';
import { AppException } from './app.exception';
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

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = getRequestId();

    if (exception instanceof AppException) {
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
      const code = mapConstraintToCode(constraintNameOf(exception));
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
          code: status === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR',
          message: exception.message,
          requestId,
        },
      });
      return;
    }

    // 未知錯誤：記完整堆疊到日誌，只回 requestId 給客戶端
    this.logger.error({ err: exception, requestId }, 'Unhandled exception');
    this.send(res, 500, {
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId },
    });
  }

  private send(res: Response, status: number, body: ErrorBody): void {
    res.status(status).json(body);
  }
}
