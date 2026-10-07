import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { DrizzleQueryError } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { runWithRequestContext } from '../../http/request-context';
import { AppException } from '../app.exception';
import { DbQueryError } from '../db-error';
import { HttpExceptionFilter, codeOfHttpStatus, flattenZodError } from '../http-exception.filter';

function capture(exception: unknown): { status: number; code: string } {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  new HttpExceptionFilter().catch(exception, host);
  const body = res.json.mock.calls[0]?.[0] as { error: { code: string } };
  return { status: res.status.mock.calls[0]?.[0] as number, code: body.error.code };
}

/** postgres-js 的唯一鍵衝突，被 Drizzle 包在 `cause` 裡。 */
function uniqueViolation(constraint: string): Error {
  return Object.assign(new Error('Failed query'), {
    cause: { code: '23505', constraint_name: constraint, message: 'duplicate key' },
  });
}

describe('HttpExceptionFilter', () => {
  it.each([
    [
      'ParseUUIDPipe 等 400',
      new BadRequestException('Validation failed (uuid is expected)'),
      400,
      'VALIDATION_FAILED',
    ],
    ['找不到路由的 404', new NotFoundException('Cannot GET /nope'), 404, 'NOT_FOUND'],
    ['guard 回 false 的 403', new ForbiddenException(), 403, 'AUTHZ_FORBIDDEN'],
    ['框架的 401', new UnauthorizedException(), 401, 'AUTH_TOKEN_INVALID'],
    ['沒列在表裡的 4xx（415）', new HttpException('Unsupported', 415), 415, 'VALIDATION_FAILED'],
    ['5xx', new HttpException('Bad gateway', 502), 502, 'INTERNAL_ERROR'],
  ])('框架例外：%s → 對應的錯誤碼', (_name, exception, status, code) => {
    expect(capture(exception)).toEqual({ status, code });
  });

  it('已登記的唯一鍵衝突 → 業務錯誤碼', () => {
    expect(capture(uniqueViolation('roles_name_key'))).toEqual({
      status: 409,
      code: 'ROLE_NAME_DUPLICATE',
    });
  });

  it('未登記的唯一鍵衝突 → 409 CONFLICT，不是 500', () => {
    expect(capture(uniqueViolation('user_roles_pkey'))).toEqual({ status: 409, code: 'CONFLICT' });
  });

  it('未知錯誤仍是 500 INTERNAL_ERROR', () => {
    expect(capture(new Error('boom'))).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
  });
});

describe('codeOfHttpStatus', () => {
  it.each([
    [400, 'VALIDATION_FAILED'],
    [401, 'AUTH_TOKEN_INVALID'],
    [403, 'AUTHZ_FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [429, 'RATE_LIMITED'],
    [413, 'VALIDATION_FAILED'],
    [499, 'VALIDATION_FAILED'],
    [500, 'INTERNAL_ERROR'],
    [503, 'INTERNAL_ERROR'],
  ])('%i → %s', (status, code) => {
    expect(codeOfHttpStatus(status)).toBe(code);
  });
});

/** 完整的回應 body（`capture` 只取狀態碼與錯誤碼）。 */
function respond(exception: unknown): { status: number; body: unknown } {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  new HttpExceptionFilter().catch(exception, host);
  return { status: res.status.mock.calls[0]?.[0] as number, body: res.json.mock.calls[0]?.[0] };
}

/** plpgsql trigger 的 `RAISE EXCEPTION 'CODE: message'`，被 Drizzle 包在 `cause` 裡。 */
function raised(message: string): Error {
  return Object.assign(new Error('Failed query'), { cause: { code: 'P0001', message } });
}

describe('HttpExceptionFilter：回應的 body（docs/architecture/backend/03-api-conventions.md）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AppException：狀態碼依錯誤碼，帶上訊息與 details', () => {
    expect(respond(new AppException('USER_EMAIL_DUPLICATE', { email: 'a@b.c' }, '重複'))).toEqual({
      status: 409,
      body: {
        error: {
          code: 'USER_EMAIL_DUPLICATE',
          message: '重複',
          details: { email: 'a@b.c' },
          requestId: undefined,
        },
      },
    });
  });

  it('在請求脈絡裡：每種錯誤都帶上 requestId', () => {
    const results = runWithRequestContext({ requestId: 'req-42' }, () => [
      respond(new AppException('NOT_FOUND')),
      respond(z.string().safeParse(1).error),
      respond(new NotFoundException()),
      respond(new Error('boom')),
    ]);
    for (const { body } of results) {
      expect(body).toMatchObject({ error: { requestId: 'req-42' } });
    }
  });

  it('ZodError → 400 VALIDATION_FAILED，details.fields 以欄位路徑對應訊息', () => {
    const schema = z.object({ name: z.string().min(1, '必填'), tags: z.array(z.string()) });
    const error = schema.safeParse({ name: '', tags: ['a', 1] }).error;
    expect(respond(error)).toEqual({
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed',
          details: { fields: { name: '必填', 'tags.1': expect.any(String) } },
          requestId: undefined,
        },
      },
    });
  });

  it('已登記的唯一鍵衝突：body 是 { code, message: Conflict }，不帶資料庫的細節', () => {
    expect(respond(uniqueViolation('users_email_key')).body).toEqual({
      error: { code: 'USER_EMAIL_DUPLICATE', message: 'Conflict', requestId: undefined },
    });
  });

  it('trigger 拋出已知的錯誤碼 → 該錯誤碼的狀態碼，details.source = database', () => {
    expect(respond(raised('ROLE_SYSTEM_PROTECTED: 系統角色不可刪除'))).toEqual({
      status: 403,
      body: {
        error: {
          code: 'ROLE_SYSTEM_PROTECTED',
          message: 'ROLE_SYSTEM_PROTECTED',
          requestId: undefined,
          details: { source: 'database' },
        },
      },
    });
  });

  it('trigger 拋出不認得的代碼 → 500 INTERNAL_ERROR（不把資料庫訊息帶給客戶端）', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    expect(respond(raised('NOT_A_KNOWN_CODE: secret detail'))).toEqual({
      status: 500,
      body: {
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: undefined },
      },
    });
  });

  it('框架的 HttpException：沿用它的狀態碼與訊息', () => {
    expect(respond(new NotFoundException('Cannot GET /nope'))).toEqual({
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'Cannot GET /nope', requestId: undefined } },
    });
  });

  it('未知錯誤：記錄完整錯誤到日誌，回應只有通用訊息', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const boom = new Error('secret stack');
    expect(respond(boom).body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: undefined },
    });
    expect(error).toHaveBeenCalledWith({ err: boom, requestId: undefined }, 'Unhandled exception');
  });

  it('未知的資料庫錯誤：仍回 500，記錄的錯誤不含查詢參數（docs/coding-standards/03-backend.md §7）', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const exception = new DrizzleQueryError(
      'update "users" set "password_hash" = $1 where "id" = $2',
      ['$argon2id$secret', 'u1'],
      Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }),
    );
    expect(respond(exception)).toEqual({
      status: 500,
      body: {
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: undefined },
      },
    });
    const logged = error.mock.calls[0]?.[0] as { err: unknown };
    expect(logged.err).toBeInstanceOf(DbQueryError);
    expect(logged.err).toMatchObject({ cause: { code: '57014' } });
    expect(logged.err).not.toHaveProperty('params');
    expect(JSON.stringify(logged)).not.toContain('secret');
    expect((logged.err as Error).message).not.toContain('secret');
    expect((logged.err as Error).stack).not.toContain('secret');
  });

  it('不是 Error 的拋出值（字串）也回 500', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    expect(respond('oops').status).toBe(500);
  });

  it('未對應的唯一鍵衝突記一筆 warn（之後補進對照表）', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    respond(uniqueViolation('user_roles_pkey'));
    expect(warn).toHaveBeenCalledWith(
      { constraint: 'user_roles_pkey', requestId: undefined },
      expect.any(String),
    );
  });
});

describe('flattenZodError', () => {
  it('同一個欄位有多個問題時只留第一個', () => {
    const error = z.string().min(5, 'too short').regex(/^\d+$/, 'digits').safeParse('ab').error!;
    expect(flattenZodError(error)).toEqual({ '(root)': 'too short' });
  });

  it('巢狀路徑以 . 連接', () => {
    const error = z.object({ a: z.object({ b: z.number() }) }).safeParse({ a: { b: 'x' } }).error!;
    expect(Object.keys(flattenZodError(error))).toEqual(['a.b']);
  });
});
