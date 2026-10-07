import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { MfaMethod, MfaMethodDefinition } from '../mfa-method';
import { MfaMethodRegistry } from '../mfa-method.registry';

function method(overrides: Partial<MfaMethodDefinition> = {}): MfaMethod {
  return {
    definition: {
      id: 'totp',
      amr: 'otp',
      realms: ['tenant', 'platform'],
      maxFactorsPerAccount: 5,
      challenge: 'none',
      enrollAt: 'anywhere',
      defaultEnabled: true,
      assurance: 'possession',
      ...overrides,
    },
    verifySchema: z.object({}),
    beginEnrollment: async () => ({ publicData: {} }),
    verify: async () => ({ ok: true }),
    describe: () => ({ label: null, hint: null }),
  };
}

describe('MfaMethodRegistry（docs/architecture/backend/21-mfa.md §2、D1）', () => {
  it('登記後可以依 id 取得，依身分範圍列出', () => {
    const registry = new MfaMethodRegistry();
    registry.register(method());
    registry.register(method({ id: 'email', realms: ['tenant'] }));
    expect(registry.get('totp')?.definition.id).toBe('totp');
    expect(registry.get('webauthn')).toBeUndefined();
    expect(registry.list('platform').map((m) => m.definition.id)).toEqual(['totp']);
    expect(registry.list().map((m) => m.definition.id)).toEqual(['totp', 'email']);
  });

  it.each([
    ['重複的 id', [method(), method()], '重複'],
    ['不是 camelCase', [method({ id: 'Web-Authn' })], 'camelCase'],
    ['保留字 recovery', [method({ id: 'recovery' })], '保留字'],
    ['沒有身分範圍', [method({ realms: [] })], '身分範圍'],
    ['數量上限不是正整數', [method({ maxFactorsPerAccount: 0 })], '正整數'],
  ])('%s → 啟動失敗', (_label, methods, message) => {
    const registry = new MfaMethodRegistry();
    expect(() => methods.forEach((m) => registry.register(m))).toThrow(message);
  });
});
