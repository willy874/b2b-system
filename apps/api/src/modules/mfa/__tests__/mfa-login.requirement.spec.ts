import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { MfaFactor, MfaMethod } from '@/core/mfa';

import type { MfaAccountStore, MfaStoredAccount } from '../mfa-account.store';
import { MfaLoginService } from '../mfa-login.service';

function method(id: string): MfaMethod {
  return {
    definition: {
      id,
      amr: id,
      realms: ['tenant'],
      maxFactorsPerAccount: 5,
      challenge: 'none',
      enrollAt: 'anywhere',
      defaultEnabled: true,
      assurance: 'possession',
    },
    verifySchema: z.object({}),
    beginEnrollment: async () => ({ publicData: {} }),
    verify: async () => ({ ok: true }),
    describe: () => ({ label: null, hint: null }),
  };
}

function factor(methodId: string, status: 'active' | 'pending' = 'active'): MfaFactor {
  return {
    id: `${methodId}-${status}`,
    accountId: 'u1',
    method: methodId,
    label: null,
    status,
    secretEncrypted: null,
    config: {},
    lastUsedCounter: null,
    lastUsedAt: null,
    interactionUid: null,
    createdAt: new Date(),
    confirmedAt: null,
  };
}

const stored: MfaStoredAccount = {
  account: {
    id: 'u1',
    email: 'u1@example.com',
    displayName: 'U1',
    locale: 'zh-TW',
    realm: 'tenant',
    tenant: null,
  },
  active: true,
  locked: false,
  mfaEnabled: false,
};

function setup(input: {
  factors: MfaFactor[];
  available: string[];
  recoveryCodes: number;
  required: boolean;
}) {
  const store = {
    realm: 'tenant',
    repo: {
      listFactors: vi.fn(async () => input.factors),
      countRecoveryCodes: vi.fn(async () => input.recoveryCodes),
    },
  } as unknown as MfaAccountStore;
  const mfa = { availableMethods: vi.fn(async () => input.available.map(method)) };
  const availability = { isRequired: vi.fn(async () => input.required) };
  const service = new MfaLoginService(
    mfa as never,
    availability as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return service.requirementFor(store, stored);
}

describe('MfaLoginService.requirementFor（docs/architecture/backend/21-mfa.md §4.1 的判斷表）', () => {
  it.each([
    [
      '有可用的因子 → challenge（即使政策沒要求）',
      [factor('totp')],
      ['totp'],
      0,
      false,
      'challenge',
    ],
    [
      '方式被關掉、有備用碼 → challenge（只能用備用碼）',
      [factor('totp')],
      ['email'],
      3,
      false,
      'challenge',
    ],
    [
      '方式被關掉、沒有備用碼 → unavailable（fail-closed，D8）',
      [factor('totp')],
      ['email'],
      0,
      true,
      'unavailable',
    ],
    ['沒有因子、必須啟用、有可用的方式 → enroll', [], ['totp'], 0, true, 'enroll'],
    ['沒有因子、必須啟用、沒有可用的方式 → unavailable', [], [], 0, true, 'unavailable'],
    ['沒有因子、不必啟用 → none', [], ['totp'], 0, false, 'none'],
    ['只有 pending 的因子不算已設定', [factor('totp', 'pending')], ['totp'], 0, false, 'none'],
    [
      '不在註冊表的方式（程式移除）不算可用，但仍算已設定',
      [factor('legacy')],
      ['totp'],
      0,
      false,
      'unavailable',
    ],
  ] as const)('%s', async (_label, factors, available, recoveryCodes, required, expected) => {
    expect(
      await setup({ factors: [...factors], available: [...available], recoveryCodes, required }),
    ).toBe(expected);
  });
});
