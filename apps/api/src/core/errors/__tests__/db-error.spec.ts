import { inspect } from 'node:util';

import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { DbQueryError, describeDbError, redactDbError } from '../db-error';
import { constraintNameOf, isUniqueViolation } from '../postgres-error';

const SQL = 'update "users" set "password_hash" = $1, "email" = $2 where "id" = $3';

/** postgres.js 的驅動錯誤：`detail` 會帶到資料的值。 */
function driverError(): Error {
  return Object.assign(
    new Error('duplicate key value violates unique constraint "users_email_key"'),
    {
      code: '23505',
      constraint_name: 'users_email_key',
      detail: 'Key (email)=(leak@example.com) already exists.',
    },
  );
}

function queryError(): DrizzleQueryError {
  return new DrizzleQueryError(
    SQL,
    ['$argon2id$secret-hash', 'leak@example.com', 'u1'],
    driverError(),
  );
}

/** 任何形式的輸出（JSON、inspect）都找不到參數。 */
function expectNoParams(value: unknown): void {
  for (const text of [JSON.stringify(value), inspect(value, { depth: 10 })]) {
    expect(text).not.toContain('secret-hash');
    expect(text).not.toContain('leak@example.com');
  }
}

describe('describeDbError（docs/architecture/backend/03-api-conventions.md §6）', () => {
  it('查詢錯誤：只留型別、SQL 本文、堆疊位置與驅動錯誤的 code／constraint_name／message', () => {
    const described = describeDbError(queryError());
    expect(described).toEqual({
      type: 'DrizzleQueryError',
      message: `Failed query: ${SQL}`,
      query: SQL,
      stack: expect.stringMatching(
        /^DrizzleQueryError: Failed query: update "users"[\s\S]*\n\s+at /,
      ),
      cause: {
        code: '23505',
        constraint_name: 'users_email_key',
        message: 'duplicate key value violates unique constraint "users_email_key"',
      },
    });
    expectNoParams(described);
  });

  it('沒有 cause 的查詢錯誤 → cause 是 undefined', () => {
    expect(describeDbError(new DrizzleQueryError(SQL, ['x'], undefined))?.cause).toBeUndefined();
  });

  it('已經拿掉參數的 DbQueryError 也描述得出來（日誌記錄重新拋出的錯誤時）', () => {
    const redacted = redactDbError(queryError());
    expect(describeDbError(redacted)).toMatchObject({
      type: 'DbQueryError',
      query: SQL,
      cause: { code: '23505' },
    });
  });

  it.each([
    ['一般的 Error', new Error('boom')],
    ['字串', 'oops'],
    ['null', null],
    ['只有 query 沒有 params 的物件', Object.assign(new Error('x'), { query: 'select 1' })],
  ])('不是查詢錯誤（%s）→ undefined', (_name, error) => {
    expect(describeDbError(error)).toBeUndefined();
  });
});

describe('redactDbError', () => {
  it('查詢錯誤 → 不帶參數的 DbQueryError：訊息、屬性、堆疊、cause 都沒有參數', () => {
    const redacted = redactDbError(queryError());
    expect(redacted).toBeInstanceOf(DbQueryError);
    expect(redacted).toMatchObject({
      name: 'DbQueryError',
      message: `Failed query: ${SQL}`,
      query: SQL,
    });
    expect(redacted).not.toHaveProperty('params');
    expectNoParams(redacted);
    expect((redacted as Error).stack).not.toContain('params:');
  });

  it('保留驅動錯誤的 code 與約束名稱：唯一鍵衝突的判斷照常可用', () => {
    const redacted = redactDbError(queryError());
    expect(isUniqueViolation(redacted)).toBe(true);
    expect(constraintNameOf(redacted)).toBe('users_email_key');
  });

  it('不是查詢錯誤 → 原樣回傳同一個物件', () => {
    const error = new Error('boom');
    expect(redactDbError(error)).toBe(error);
    expect(redactDbError('oops')).toBe('oops');
  });
});
