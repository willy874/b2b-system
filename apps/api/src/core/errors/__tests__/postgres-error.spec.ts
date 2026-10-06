import { describe, expect, it } from 'vitest';

import {
  constraintNameOf,
  isForeignKeyViolation,
  isUniqueViolation,
  mapConstraintToCode,
  raisedErrorCode,
} from '../postgres-error';

/** postgres-js 的錯誤，被 Drizzle 包一層（`Failed query: …`）放在 `cause`。 */
function wrapped(cause: Record<string, unknown>): Error {
  return Object.assign(new Error('Failed query: insert …'), { cause });
}

describe('postgres-error：辨識 Postgres 的錯誤', () => {
  it.each([
    ['驅動直接拋出', { code: '23505' }, true],
    ['Drizzle 包在 cause 裡', wrapped({ code: '23505' }), true],
    ['包了兩層', wrapped({ cause: { code: '23505' } }), true],
    ['外鍵違反', { code: '23503' }, false],
    ['沒有 code', new Error('boom'), false],
    ['null', null, false],
    ['字串', '23505', false],
  ])('isUniqueViolation：%s → %s', (_name, error, expected) => {
    expect(isUniqueViolation(error)).toBe(expected);
  });

  it.each([
    ['驅動直接拋出', { code: '23503' }, true],
    ['Drizzle 包在 cause 裡', wrapped({ code: '23503' }), true],
    ['唯一鍵衝突', wrapped({ code: '23505' }), false],
    ['undefined', undefined, false],
  ])('isForeignKeyViolation：%s → %s', (_name, error, expected) => {
    expect(isForeignKeyViolation(error)).toBe(expected);
  });

  it('外層已有 code 時不往 cause 找（外層就是驅動的錯誤）', () => {
    const error = Object.assign(new Error('x'), { code: 'ECONNRESET', cause: { code: '23505' } });
    expect(isUniqueViolation(error)).toBe(false);
  });

  it.each([
    [
      '包在 cause 裡',
      wrapped({ code: '23505', constraint_name: 'users_email_key' }),
      'users_email_key',
    ],
    ['沒有約束名稱', wrapped({ code: '23505' }), undefined],
    ['不是物件', 42, undefined],
  ])('constraintNameOf：%s', (_name, error, expected) => {
    expect(constraintNameOf(error)).toBe(expected);
  });

  it.each([
    [
      'trigger 的 RAISE EXCEPTION',
      wrapped({ code: 'P0001', message: 'ROLE_SYSTEM_PROTECTED: 系統角色' }),
      'ROLE_SYSTEM_PROTECTED',
    ],
    ['直接拋出', { code: 'P0001', message: 'USER_SELF_ACTION: no' }, 'USER_SELF_ACTION'],
    ['開頭不是大寫代碼', wrapped({ code: 'P0001', message: 'duplicate key: x' }), undefined],
    ['代碼不在開頭', wrapped({ code: 'P0001', message: 'error ROLE_X: y' }), undefined],
    ['沒有冒號', wrapped({ code: 'P0001', message: 'ROLE_SYSTEM_PROTECTED' }), undefined],
    ['沒有訊息', wrapped({ code: 'P0001' }), undefined],
    ['null', null, undefined],
  ])('raisedErrorCode：%s', (_name, error, expected) => {
    expect(raisedErrorCode(error)).toBe(expected);
  });

  it.each([
    ['users_email_key', 'USER_EMAIL_DUPLICATE'],
    ['users_username_key', 'USER_USERNAME_DUPLICATE'],
    ['roles_name_key', 'ROLE_NAME_DUPLICATE'],
    ['roles_slug_key', 'ROLE_NAME_DUPLICATE'],
    ['user_roles_pkey', 'CONFLICT'],
    [undefined, 'CONFLICT'],
  ])('mapConstraintToCode：%s → %s', (constraint, expected) => {
    expect(mapConstraintToCode(constraint)).toBe(expected);
  });
});
