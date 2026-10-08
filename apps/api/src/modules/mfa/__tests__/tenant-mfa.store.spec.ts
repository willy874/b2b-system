import { SessionRevokedReason } from '@b2b-system/realtime';
import { describe, expect, it, vi } from 'vitest';

import type { DbOrTx } from '@/core/database';
import { DomainEvent } from '@/core/events';
import { runInTenantContext } from '@/core/tenant';
import type { TenantContext } from '@/core/tenant';
import type { UserRow } from '@/db/schema';

import type { MfaAuditKind } from '../mfa-account.store';
import { TenantMfaStore } from '../tenant-mfa.store';
import { account, storedAccount, TENANT_ID, USER_ID } from './mfa.fixture';

const TENANT: TenantContext = {
  id: TENANT_ID,
  code: 'acme',
  db: {} as never,
  storageBucket: 'bucket',
  features: [],
  flags: {},
  featureParams: {},
};

function inTenant<T>(fn: () => T): T {
  return runInTenantContext(TENANT, fn);
}

function user(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: USER_ID,
    email: 'tenant@example.com',
    displayName: 'Alice',
    locale: 'en-US',
    kind: 'human',
    status: 'active',
    deletedAt: null,
    lockedUntil: null,
    mfaEnabled: true,
    passwordHash: 'hash',
    ...overrides,
  } as UserRow;
}

/** `null` = 找不到這個帳號。 */
function setup(row: UserRow | null = user()) {
  const found = row ?? undefined;
  const db = { transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({ name: 'tx' })) };
  const repo = { name: 'repo' };
  const users = {
    findAccountById: vi.fn(async () => found),
    incrementTokenVersion: vi.fn(async () => undefined),
    listRoleSummaries: vi.fn(async () => [{ id: 'role-a', name: 'A' }]),
  };
  const logins = {
    throttleScope: vi.fn(() => TENANT_ID),
    recordFailedAttempt: vi.fn(async () => undefined),
    completeLogin: vi.fn(async () => undefined),
  };
  const refreshTokens = { revokeAllForUser: vi.fn(async () => undefined) };
  const passwords = {
    verify: vi.fn(async () => true),
    verifyAgainstDummy: vi.fn(async () => false),
  };
  const audits = {
    record: vi.fn(async () => undefined),
    recordSafely: vi.fn(async () => undefined),
  };
  const jobs = { enqueue: vi.fn(async () => undefined) };
  const events = { publish: vi.fn() };
  const userCache = { invalidate: vi.fn() };
  const directory = { findById: vi.fn(async () => ({ name: 'Acme Inc.' })) };
  const store = new TenantMfaStore(
    db as never,
    repo as never,
    users as never,
    logins as never,
    refreshTokens as never,
    passwords as never,
    audits as never,
    jobs as never,
    events as never,
    userCache as never,
    directory as never,
  );
  return {
    store,
    repo,
    users,
    logins,
    refreshTokens,
    passwords,
    audits,
    jobs,
    events,
    userCache,
    directory,
  };
}

describe('TenantMfaStore（docs/architecture/backend/21-mfa.md D5、§12）', () => {
  describe('findAccount', () => {
    it('人類使用者 → 帳號狀態，租戶名稱取自目錄', async () => {
      const { store } = setup();
      expect(await inTenant(() => store.findAccount(USER_ID))).toEqual({
        account: {
          id: USER_ID,
          email: 'tenant@example.com',
          displayName: 'Alice',
          locale: 'en-US',
          realm: 'tenant',
          tenant: { id: TENANT_ID, code: 'acme', name: 'Acme Inc.' },
        },
        active: true,
        locked: false,
        mfaEnabled: true,
      });
    });

    it('目錄裡找不到租戶時以代碼當名稱；停用、刪除、鎖定反映在狀態', async () => {
      const ctx = setup(user({ status: 'disabled' as UserRow['status'] }));
      ctx.directory.findById.mockResolvedValue(undefined as never);
      const stored = await inTenant(() => ctx.store.findAccount(USER_ID));
      expect(stored?.account.tenant?.name).toBe('acme');
      expect(stored?.active).toBe(false);

      const deleted = setup(
        user({ deletedAt: new Date(), lockedUntil: new Date(Date.now() + 60_000) }),
      );
      const result = await inTenant(() => deleted.store.findAccount(USER_ID));
      expect(result).toMatchObject({ active: false, locked: true });
    });

    it.each([
      ['不存在', null],
      ['服務帳號', user({ kind: 'service' as UserRow['kind'] })],
    ])('%s → undefined', async (_label, found) => {
      const { store } = setup(found);
      expect(await inTenant(() => store.findAccount(USER_ID))).toBeUndefined();
    });
  });

  describe('verifyPassword', () => {
    it('比對密碼雜湊', async () => {
      const { store, passwords } = setup();
      expect(await store.verifyPassword(USER_ID, 'pw')).toBe(true);
      expect(passwords.verify).toHaveBeenCalledWith('hash', 'pw');
    });

    it('沒有密碼（或找不到）時以假雜湊比對，時間相同', async () => {
      const { store, passwords } = setup(user({ passwordHash: null }));
      expect(await store.verifyPassword(USER_ID, 'pw')).toBe(false);
      expect(passwords.verifyAgainstDummy).toHaveBeenCalledWith('pw');
      expect(passwords.verify).not.toHaveBeenCalled();
    });
  });

  describe('audit', () => {
    it.each([
      ['factorAdd', 'mfa.factor.add', 'auth'],
      ['factorRemove', 'mfa.factor.remove', 'auth'],
      ['recoveryRegenerate', 'mfa.recoveryCodes.regenerate', 'auth'],
      ['recoveryUse', 'mfa.recoveryCode.use', 'auth'],
      ['loginFailure', 'auth.login.failure', 'auth'],
    ] as const)('%s → %s，沒帶 tx 時寫入失敗不影響回應', async (kind, action, resourceType) => {
      const { store, audits } = setup();
      await store.audit({ kind: kind as MfaAuditKind, target: account(), metadata: { a: 1 } });
      expect(audits.recordSafely).toHaveBeenCalledWith({
        action,
        resourceType,
        resourceId: USER_ID,
        result: 'success',
        errorCode: null,
        actorId: USER_ID,
        actorEmail: 'tenant@example.com',
        metadata: { a: 1 },
      });
    });

    it('reset 帶 tx：記在 user 資源（含 email）、操作者是管理員、與寫入同一個交易', async () => {
      const { store, audits } = setup();
      const tx = { name: 'tx' } as unknown as DbOrTx;
      await store.audit(
        {
          kind: 'reset',
          target: account(),
          actor: { id: 'admin-1', email: 'admin@example.com' },
          result: 'failure',
          errorCode: 'X',
        },
        tx,
      );
      expect(audits.record).toHaveBeenCalledWith(
        {
          action: 'user.mfa.reset',
          resourceType: 'user',
          resourceId: USER_ID,
          resourceName: 'tenant@example.com',
          result: 'failure',
          errorCode: 'X',
          actorId: 'admin-1',
          actorEmail: 'admin@example.com',
          metadata: undefined,
        },
        tx,
      );
    });
  });

  it('enqueue：帶 tx 時走 outbox，沒帶時直接入列', async () => {
    const { store, jobs } = setup();
    const type = { name: 'job' } as never;
    const tx = { name: 'tx' } as unknown as DbOrTx;
    await store.enqueue(type, { a: 1 }, tx);
    await store.enqueue(type, { a: 2 });
    expect(jobs.enqueue).toHaveBeenNthCalledWith(1, type, { a: 1 }, { tx });
    expect(jobs.enqueue).toHaveBeenNthCalledWith(2, type, { a: 2 }, {});
  });

  it('revokeSessions：交易內遞增 token 版本、撤銷 refresh；提交後清快取並發 SESSIONS_REVOKED', async () => {
    const { store, users, refreshTokens, userCache, events } = setup();
    await store.transaction(async (tx) => {
      await store.revokeSessions(USER_ID, tx);
      expect(users.incrementTokenVersion).toHaveBeenCalledWith(USER_ID, tx);
      expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith(USER_ID, 'mfa_reset', tx);
      expect(events.publish).not.toHaveBeenCalled();
    });
    expect(userCache.invalidate).toHaveBeenCalledWith(USER_ID);
    expect(events.publish).toHaveBeenCalledWith(DomainEvent.SESSIONS_REVOKED, {
      userIds: [USER_ID],
      reason: SessionRevokedReason.TOKEN_STALE,
    });
  });

  it('mfaStatusChanged：清快取並推播使用者列表的變更（帶角色）', async () => {
    const { store, userCache, events } = setup();
    await store.mfaStatusChanged(USER_ID);
    expect(userCache.invalidate).toHaveBeenCalledWith(USER_ID);
    expect(events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, {
      changes: [expect.objectContaining({ id: USER_ID })],
      affectedUserIds: [USER_ID],
    });
  });

  describe('登入的第二步', () => {
    it('throttleScope 與 oidcAccountId 屬於目前的租戶', () => {
      const { store } = setup();
      expect(store.throttleScope()).toBe(TENANT_ID);
      expect(inTenant(() => store.oidcAccountId(USER_ID))).toBe(`t:${TENANT_ID}:${USER_ID}`);
    });

    it('recordLoginFailure／completeLogin 以最新的使用者列轉給登入服務', async () => {
      const { store, logins } = setup();
      await store.recordLoginFailure(storedAccount(), '1.2.3.0', { step: 'mfa' });
      await store.completeLogin(storedAccount(), { amr: ['pwd', 'mfa', 'otp'], mfaMethod: 'totp' });
      expect(logins.recordFailedAttempt).toHaveBeenCalledWith(user(), '1.2.3.0', { step: 'mfa' });
      expect(logins.completeLogin).toHaveBeenCalledWith(user(), {
        amr: ['pwd', 'mfa', 'otp'],
        mfaMethod: 'totp',
      });
    });

    it('使用者已不存在時不記錄', async () => {
      const { store, logins } = setup(null);
      await store.recordLoginFailure(storedAccount(), '1.2.3.0', {});
      await store.completeLogin(storedAccount(), { amr: ['pwd'] });
      expect(logins.recordFailedAttempt).not.toHaveBeenCalled();
      expect(logins.completeLogin).not.toHaveBeenCalled();
    });
  });
});
