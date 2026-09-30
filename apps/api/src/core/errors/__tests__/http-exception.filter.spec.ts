import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { HttpExceptionFilter, codeOfHttpStatus } from '../http-exception.filter';

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
  it('429 → RATE_LIMITED、409 → CONFLICT', () => {
    expect(codeOfHttpStatus(429)).toBe('RATE_LIMITED');
    expect(codeOfHttpStatus(409)).toBe('CONFLICT');
  });
});
