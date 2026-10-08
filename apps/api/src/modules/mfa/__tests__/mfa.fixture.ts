import { vi } from 'vitest';
import { z } from 'zod';

import { MfaMethodRegistry } from '@/core/mfa';
import type {
  MfaAccount,
  MfaChallenge,
  MfaFactor,
  MfaMethod,
  MfaMethodDefinition,
  MfaRealm,
} from '@/core/mfa';

import type { MfaAccountStore, MfaStoredAccount } from '../mfa-account.store';

/** MFA 單元測試共用的假物件（docs/architecture/backend/21-mfa.md）。 */

export const TENANT_ID = '11111111-1111-4111-8111-111111111111';
export const USER_ID = '22222222-2222-4222-8222-222222222222';
export const ADMIN_ID = '33333333-3333-4333-8333-333333333333';

export function method(
  id: string,
  definition: Partial<MfaMethodDefinition> = {},
  impl: Partial<Omit<MfaMethod, 'definition'>> = {},
): MfaMethod {
  return {
    definition: {
      id,
      amr: `${id}Amr`,
      realms: ['tenant', 'platform'],
      maxFactorsPerAccount: 5,
      challenge: 'none',
      enrollAt: 'anywhere',
      defaultEnabled: true,
      assurance: 'possession',
      ...definition,
    },
    verifySchema: z.object({ code: z.string() }),
    beginEnrollment: vi.fn(async () => ({ publicData: { uri: `otpauth://${id}` } })),
    verify: vi.fn(async () => ({ ok: true as const })),
    describe: vi.fn((target: MfaFactor) => ({ label: target.label ?? `${id} label`, hint: null })),
    ...impl,
  };
}

export function registryOf(...methods: MfaMethod[]): MfaMethodRegistry {
  const registry = new MfaMethodRegistry();
  for (const item of methods) registry.register(item);
  return registry;
}

export function factor(overrides: Partial<MfaFactor> = {}): MfaFactor {
  return {
    id: 'factor-1',
    accountId: USER_ID,
    method: 'totp',
    label: null,
    status: 'active',
    secretEncrypted: null,
    config: {},
    lastUsedCounter: null,
    lastUsedAt: null,
    interactionUid: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    confirmedAt: null,
    ...overrides,
  };
}

export function challenge(overrides: Partial<MfaChallenge> = {}): MfaChallenge {
  return {
    id: 'challenge-1',
    factorId: 'factor-1',
    purpose: 'login',
    state: {},
    attempts: 0,
    expiresAt: new Date(Date.now() + 10 * 60_000),
    resendAfter: new Date(Date.now() + 60_000),
    consumedAt: null,
    createdAt: new Date(Date.now() - 1_000),
    ...overrides,
  };
}

export function account(
  realm: MfaRealm = 'tenant',
  overrides: Partial<MfaAccount> = {},
): MfaAccount {
  return {
    id: realm === 'tenant' ? USER_ID : ADMIN_ID,
    email: `${realm}@example.com`,
    displayName: realm === 'tenant' ? 'Alice' : 'Root',
    locale: 'zh-TW',
    realm,
    tenant: realm === 'tenant' ? { id: TENANT_ID, code: 'acme', name: 'Acme' } : null,
    ...overrides,
  };
}

export function storedAccount(
  realm: MfaRealm = 'tenant',
  overrides: Partial<MfaStoredAccount> = {},
): MfaStoredAccount {
  return { account: account(realm), active: true, locked: false, mfaEnabled: false, ...overrides };
}

/** 假的 `MfaAccountStore`：repo 的每個方法都是 `vi.fn()`，交易直接以假的 tx 執行。 */
export function fakeStore(realm: MfaRealm = 'tenant', stored = storedAccount(realm)) {
  const tx = { name: `${realm}-tx` };
  const repo = {
    listFactors: vi.fn(async (): Promise<MfaFactor[]> => []),
    findFactor: vi.fn(async (): Promise<MfaFactor | undefined> => undefined),
    insertFactor: vi.fn(async (values: Partial<MfaFactor>) =>
      factor({ id: 'factor-new', status: 'pending', ...values }),
    ),
    activateFactor: vi.fn(async () => true),
    recordFactorUse: vi.fn(async () => true),
    deleteFactor: vi.fn(async () => true),
    deleteFactors: vi.fn(async () => 0),
    deletePendingFactors: vi.fn(async () => undefined),
    syncMfaEnabled: vi.fn(async () => true),
    countActiveFactorsByMethod: vi.fn(async () => new Map<string, number>()),
    insertChallenge: vi.fn(
      async (values: {
        id: string;
        factorId: string;
        purpose: MfaChallenge['purpose'];
        state: Record<string, unknown>;
        expiresAt: Date;
        resendAfter: Date;
      }): Promise<MfaChallenge> => challenge({ ...values, attempts: 0, createdAt: new Date() }),
    ),
    findChallenge: vi.fn(async (): Promise<MfaChallenge | undefined> => undefined),
    latestChallenge: vi.fn(async (): Promise<MfaChallenge | undefined> => undefined),
    updateChallengeState: vi.fn(async () => true),
    incrementChallengeAttempts: vi.fn(async () => 1),
    consumeChallenge: vi.fn(async () => true),
    replaceRecoveryCodes: vi.fn(async () => undefined),
    consumeRecoveryCode: vi.fn(async () => true),
    countRecoveryCodes: vi.fn(async () => 0),
    deleteStaleBatch: vi.fn(async () => 0),
  };
  const store = {
    realm,
    repo,
    findAccount: vi.fn(async (): Promise<MfaStoredAccount | undefined> => stored),
    verifyPassword: vi.fn(async () => true),
    transaction: vi.fn(<T>(fn: (t: unknown) => Promise<T>) => fn(tx)),
    audit: vi.fn(async () => undefined),
    enqueue: vi.fn(async () => undefined),
    revokeSessions: vi.fn(async () => undefined),
    mfaStatusChanged: vi.fn(async () => undefined),
    throttleScope: vi.fn(() => (realm === 'tenant' ? TENANT_ID : 'platform')),
    recordLoginFailure: vi.fn(async () => undefined),
    completeLogin: vi.fn(async () => undefined),
    oidcAccountId: vi.fn((id: string) => (realm === 'tenant' ? `t:${TENANT_ID}:${id}` : `p:${id}`)),
  };
  return { store, repo, tx, asStore: store as unknown as MfaAccountStore };
}

export type FakeStore = ReturnType<typeof fakeStore>;
