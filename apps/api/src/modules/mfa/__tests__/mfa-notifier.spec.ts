import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobContext } from '@/core/jobs';
import type { MfaRealm } from '@/core/mfa';

import {
  MFA_PLATFORM_SECURITY_NOTICE_JOB,
  MFA_SECURITY_NOTICE_JOB,
  MfaNotifier,
} from '../mfa-notifier';
import { account, ADMIN_ID, fakeStore, storedAccount, USER_ID } from './mfa.fixture';

const JOB = { id: 'job-1' } as JobContext;

function setup() {
  const jobs = { register: vi.fn() };
  const mail = { send: vi.fn(async () => ({ messageId: 'msg-1' })) };
  const tenant = fakeStore('tenant');
  const platform = fakeStore('platform');
  const audit = { record: vi.fn(async () => undefined) };
  const platformAudit = { record: vi.fn(async () => undefined) };
  const notifier = new MfaNotifier(
    jobs as never,
    mail as never,
    tenant.asStore as never,
    platform.asStore as never,
    audit as never,
    platformAudit as never,
  );
  return { notifier, jobs, mail, tenant, platform, audit, platformAudit };
}

describe('MfaNotifier（docs/architecture/backend/21-mfa.md §7 安全通知信）', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('onModuleInit 登記租戶與平台兩個寄信工作，各自以對應的身分範圍寄出', async () => {
    const { notifier, jobs, tenant, platform } = setup();
    notifier.onModuleInit();
    const handlers = new Map(
      jobs.register.mock.calls.map(([type, handler]) => [
        type,
        handler as (data: unknown, ctx: JobContext) => Promise<unknown>,
      ]),
    );
    await handlers.get(MFA_SECURITY_NOTICE_JOB)!({ accountId: USER_ID, event: 'reset' }, JOB);
    await handlers.get(MFA_PLATFORM_SECURITY_NOTICE_JOB)!(
      { accountId: ADMIN_ID, event: 'reset' },
      JOB,
    );
    expect(tenant.store.findAccount).toHaveBeenCalledWith(USER_ID);
    expect(platform.store.findAccount).toHaveBeenCalledWith(ADMIN_ID);
  });

  it.each([
    ['tenant', MFA_SECURITY_NOTICE_JOB],
    ['platform', MFA_PLATFORM_SECURITY_NOTICE_JOB],
  ] as const)('securityChanged：%s 帳號在呼叫端的交易內入列對應的工作', async (realm, job) => {
    const { notifier } = setup();
    const store = fakeStore(realm);
    await notifier.securityChanged(store.asStore, account(realm), 'factorAdded', store.tx);
    expect(store.store.enqueue).toHaveBeenCalledWith(
      job,
      { accountId: account(realm).id, event: 'factorAdded' },
      store.tx,
    );
  });

  it.each(['tenant', 'platform'] as const)(
    'send：%s 的帳號已不存在 → 略過，不寄',
    async (realm: MfaRealm) => {
      const ctx = setup();
      ctx[realm].store.findAccount.mockResolvedValue(undefined);
      expect(await ctx.notifier.send(realm, { accountId: 'x', event: 'reset' }, JOB)).toEqual({
        skipped: 'account_not_found',
      });
      expect(ctx.mail.send).not.toHaveBeenCalled();
    },
  );

  it('send：租戶帳號依語系寄信，稽核記在租戶（含收件人）', async () => {
    const { notifier, tenant, mail, audit, platformAudit } = setup();
    tenant.store.findAccount.mockResolvedValue(
      storedAccount('tenant', { account: account('tenant', { locale: 'en-US' }) }),
    );
    expect(
      await notifier.send('tenant', { accountId: USER_ID, event: 'factorRemoved' }, JOB),
    ).toEqual({ messageId: 'msg-1' });
    expect(mail.send).toHaveBeenCalledWith(
      'tenant@example.com',
      expect.objectContaining({ subject: 'Your account security settings changed' }),
    );
    expect(audit.record).toHaveBeenCalledWith({
      action: 'mail.send',
      resourceType: 'user',
      resourceId: USER_ID,
      resourceName: 'tenant@example.com',
      metadata: {
        template: 'mfa.securityNotice.factorRemoved',
        jobId: 'job-1',
        messageId: 'msg-1',
      },
    });
    expect(platformAudit.record).not.toHaveBeenCalled();
  });

  it('send：平台管理者寄預設語系的信，稽核記在平台', async () => {
    const { notifier, mail, audit, platformAudit } = setup();
    await notifier.send('platform', { accountId: ADMIN_ID, event: 'reset' }, JOB);
    expect(mail.send).toHaveBeenCalledWith(
      'platform@example.com',
      expect.objectContaining({ subject: '你的帳號安全設定有變更' }),
    );
    expect(platformAudit.record).toHaveBeenCalledWith({
      action: 'mail.send',
      resourceType: 'platformAdmin',
      resourceId: ADMIN_ID,
      metadata: { template: 'mfa.securityNotice.reset', jobId: 'job-1', messageId: 'msg-1' },
    });
    expect(audit.record).not.toHaveBeenCalled();
  });
});
