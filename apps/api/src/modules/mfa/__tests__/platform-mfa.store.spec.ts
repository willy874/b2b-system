import { describe, expect, it, vi } from 'vitest';

import type { PlatformDbOrTx } from '@/core/database';
import type { PlatformAdminRow } from '@/db/platform/schema';

import type { MfaAuditKind } from '../mfa-account.store';
import { PlatformMfaStore } from '../platform-mfa.store';
import { account, ADMIN_ID, storedAccount } from './mfa.fixture';

function admin(overrides: Partial<PlatformAdminRow> = {}): PlatformAdminRow {
  return {
    id: ADMIN_ID,
    email: 'platform@example.com',
    displayName: 'Root',
    status: 'active',
    lockedUntil: null,
    mfaEnabled: false,
    ...overrides,
  } as PlatformAdminRow;
}

/** `null` = 找不到這個帳號。 */
function setup(row: PlatformAdminRow | null = admin()) {
  const found = row ?? undefined;
  const db = { transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({ name: 'tx' })) };
  const repo = { name: 'repo' };
  const admins = {
    findById: vi.fn(async () => found),
    throttleScope: vi.fn(() => 'platform'),
    recordFailedAttempt: vi.fn(async () => undefined),
    completeLogin: vi.fn(async () => undefined),
  };
  const accounts = {
    verifyPassword: vi.fn(async () => true),
    endAllSessions: vi.fn(async () => undefined),
  };
  const audits = {
    record: vi.fn(async () => undefined),
    recordSafely: vi.fn(async () => undefined),
  };
  const jobs = { enqueue: vi.fn(async () => undefined) };
  const store = new PlatformMfaStore(
    db as never,
    repo as never,
    admins as never,
    accounts as never,
    audits as never,
    jobs as never,
  );
  return { store, admins, accounts, audits, jobs };
}

describe('PlatformMfaStore（docs/architecture/backend/21-mfa.md D5）', () => {
  describe('findAccount', () => {
    it('平台管理者 → 預設語系、沒有租戶的帳號狀態', async () => {
      const { store } = setup();
      expect(await store.findAccount(ADMIN_ID)).toEqual({
        account: {
          id: ADMIN_ID,
          email: 'platform@example.com',
          displayName: 'Root',
          locale: 'zh-TW',
          realm: 'platform',
          tenant: null,
        },
        active: true,
        locked: false,
        mfaEnabled: false,
      });
    });

    it('停用與鎖定中反映在狀態；鎖定已過期不算', async () => {
      const locked = setup(
        admin({
          status: 'disabled' as PlatformAdminRow['status'],
          lockedUntil: new Date(Date.now() + 60_000),
        }),
      );
      expect(await locked.store.findAccount(ADMIN_ID)).toMatchObject({
        active: false,
        locked: true,
      });
      const expired = setup(admin({ lockedUntil: new Date(Date.now() - 60_000) }));
      expect(await expired.store.findAccount(ADMIN_ID)).toMatchObject({ locked: false });
    });

    it('不存在 → undefined', async () => {
      const { store } = setup(null);
      expect(await store.findAccount(ADMIN_ID)).toBeUndefined();
    });
  });

  it('verifyPassword 交給平台帳號服務', async () => {
    const { store, accounts } = setup();
    expect(await store.verifyPassword(ADMIN_ID, 'pw')).toBe(true);
    expect(accounts.verifyPassword).toHaveBeenCalledWith(ADMIN_ID, 'pw');
  });

  describe('audit', () => {
    it.each([
      ['factorAdd', 'platformAdmin.mfa.factor.add', 'platformAdmin'],
      ['factorRemove', 'platformAdmin.mfa.factor.remove', 'platformAdmin'],
      ['recoveryRegenerate', 'platformAdmin.mfa.recoveryCodes.regenerate', 'platformAdmin'],
      ['recoveryUse', 'platformAdmin.mfa.recoveryCode.use', 'platformAdmin'],
      ['reset', 'platformAdmin.mfa.reset', 'platformAdmin'],
      ['loginFailure', 'platformAuth.login.failure', 'platformAuth'],
    ] as const)('%s → %s（沒帶 tx 時 recordSafely）', async (kind, action, resourceType) => {
      const { store, audits } = setup();
      await store.audit({ kind: kind as MfaAuditKind, target: account('platform') });
      expect(audits.recordSafely).toHaveBeenCalledWith({
        action,
        resourceType,
        resourceId: ADMIN_ID,
        result: 'success',
        errorCode: null,
        actorId: ADMIN_ID,
        actorEmail: 'platform@example.com',
        metadata: undefined,
      });
    });

    it('帶 tx 時與寫入同一個交易，操作者可以是別人', async () => {
      const { store, audits } = setup();
      const tx = { name: 'tx' } as unknown as PlatformDbOrTx;
      await store.audit(
        {
          kind: 'reset',
          target: account('platform'),
          actor: { id: 'other', email: 'other@example.com' },
          result: 'failure',
          errorCode: 'X',
          metadata: { severity: 'high' },
        },
        tx,
      );
      expect(audits.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'other',
          actorEmail: 'other@example.com',
          result: 'failure',
          errorCode: 'X',
          metadata: { severity: 'high' },
        }),
        tx,
      );
    });
  });

  describe('enqueue（平台工作不走 outbox）', () => {
    it('沒帶 tx 時直接入列', async () => {
      const { store, jobs } = setup();
      await store.enqueue({ name: 'job' } as never, { a: 1 });
      expect(jobs.enqueue).toHaveBeenCalledWith({ name: 'job' }, { a: 1 });
    });

    it('帶 tx 時等交易提交後才入列', async () => {
      const { store, jobs } = setup();
      await store.transaction(async (tx) => {
        await store.enqueue({ name: 'job' } as never, { a: 1 }, tx);
        expect(jobs.enqueue).not.toHaveBeenCalled();
      });
      expect(jobs.enqueue).toHaveBeenCalledWith({ name: 'job' }, { a: 1 });
    });

    it('交易回滾時不入列', async () => {
      const { store, jobs } = setup();
      await expect(
        store.transaction(async (tx) => {
          await store.enqueue({ name: 'job' } as never, { a: 1 }, tx);
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect(jobs.enqueue).not.toHaveBeenCalled();
    });
  });

  it('revokeSessions 結束平台管理者所有的 session；mfaStatusChanged 沒有推播', async () => {
    const { store, accounts } = setup();
    const tx = { name: 'tx' } as unknown as PlatformDbOrTx;
    await store.revokeSessions(ADMIN_ID, tx);
    expect(accounts.endAllSessions).toHaveBeenCalledWith(ADMIN_ID, tx);
    await expect(store.mfaStatusChanged()).resolves.toBeUndefined();
  });

  describe('登入的第二步', () => {
    it('throttleScope 與 oidcAccountId', () => {
      const { store } = setup();
      expect(store.throttleScope()).toBe('platform');
      expect(store.oidcAccountId(ADMIN_ID)).toBe(`p:${ADMIN_ID}`);
    });

    it('recordLoginFailure／completeLogin 以最新的管理者列轉給平台管理者服務', async () => {
      const { store, admins } = setup();
      await store.recordLoginFailure(storedAccount('platform'), '1.2.3.0', { step: 'mfa' });
      await store.completeLogin(storedAccount('platform'), { amr: ['pwd'] });
      expect(admins.recordFailedAttempt).toHaveBeenCalledWith(admin(), '1.2.3.0', { step: 'mfa' });
      expect(admins.completeLogin).toHaveBeenCalledWith(admin(), { amr: ['pwd'] });
    });

    it('管理者已不存在時不記錄', async () => {
      const { store, admins } = setup(null);
      await store.recordLoginFailure(storedAccount('platform'), '1.2.3.0', {});
      await store.completeLogin(storedAccount('platform'), { amr: ['pwd'] });
      expect(admins.recordFailedAttempt).not.toHaveBeenCalled();
      expect(admins.completeLogin).not.toHaveBeenCalled();
    });
  });
});
