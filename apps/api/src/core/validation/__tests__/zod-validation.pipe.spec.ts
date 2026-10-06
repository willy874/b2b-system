import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { z, ZodError } from 'zod';

import { HttpExceptionFilter } from '../../errors';
import { ZodValidationPipe } from '../zod-validation.pipe';

const QuerySchema = z.object({
  name: z.string().trim().min(1),
  limit: z.coerce.number().int().max(100).default(20),
});

/** 把 pipe 拋出的錯交給 `HttpExceptionFilter`，取回客戶端看到的狀態碼與 body。 */
function respond(exception: unknown): { status: number; body: unknown } {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  new HttpExceptionFilter().catch(exception, host);
  return { status: res.status.mock.calls[0]?.[0] as number, body: res.json.mock.calls[0]?.[0] };
}

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('預期會拋錯');
}

describe('ZodValidationPipe（docs/architecture/backend/03-api-conventions.md）', () => {
  const pipe = new ZodValidationPipe(QuerySchema);

  it('合法的值：回傳 schema 解析後的結果（套用 trim、轉型與預設值）', () => {
    expect(pipe.transform({ name: '  alice ', limit: '5' })).toEqual({ name: 'alice', limit: 5 });
    expect(pipe.transform({ name: 'bob' })).toEqual({ name: 'bob', limit: 20 });
  });

  it('不在 schema 裡的欄位被去掉', () => {
    expect(pipe.transform({ name: 'a', extra: 'x' })).toEqual({ name: 'a', limit: 20 });
  });

  it('不合法的值：拋 ZodError（不是 HttpException）', () => {
    expect(thrownBy(() => pipe.transform({ name: '', limit: '500' }))).toBeInstanceOf(ZodError);
  });

  it('拋出的錯經 HttpExceptionFilter 變成 400 VALIDATION_FAILED ＋ details.fields（表單回填的契約）', () => {
    const { status, body } = respond(thrownBy(() => pipe.transform({ name: '', limit: '500' })));
    expect(status).toBe(400);
    expect(body).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: { fields: { name: expect.any(String), limit: expect.any(String) } },
        requestId: undefined,
      },
    });
  });

  it('整個值的型別就不對：錯誤掛在 (root)', () => {
    const { body } = respond(thrownBy(() => pipe.transform('not an object')));
    expect(body).toMatchObject({
      error: { details: { fields: { '(root)': expect.any(String) } } },
    });
  });
});
