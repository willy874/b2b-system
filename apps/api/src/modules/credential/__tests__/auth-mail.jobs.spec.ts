import { render } from '@b2b-system/mail-components';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '@/core/database';
import type { JobContext, JobQueue } from '@/core/jobs';
import type { MailContent, MailService } from '@/core/mail';
import type { AuditService } from '@/modules/audit-log/audit.service';

import { ACTIVATION_MAIL_JOB, PASSWORD_RESET_MAIL_JOB } from '../auth-mail.constants';
import { AuthMailJobs } from '../auth-mail.jobs';
import type { AuthTokenService } from '../auth-token.service';

const JOB: JobContext = { id: 'job-1', retryCount: 0, signal: new AbortController().signal };

function setup(user: Record<string, unknown> | undefined) {
  const select = {
    from: () => select,
    where: () => select,
    limit: async () => (user ? [user] : []),
  };
  const db = { select: () => select };
  const registered = new Map<string, (data: { userId: string }, ctx: JobContext) => unknown>();
  const jobs = {
    register: vi.fn((type: { name: string }, handler: never) => registered.set(type.name, handler)),
  };
  // 有效時數是租戶的設定（auth.activationTtlHours / auth.passwordResetTtlHours），由簽發 token 的一方決定
  const tokens = {
    issue: vi.fn(async (_userId: string, purpose: string) => ({
      raw: 'raw-token',
      expiresAt: new Date(),
      validHours: purpose === 'activation' ? 48 : 2,
    })),
  };
  const sent: Array<{ to: string; content: MailContent }> = [];
  const mail = {
    // 帳號流程的連結在 apps/platform（docs/architecture/04-sso.md §12）
    accountLink: (path: string, query: Record<string, string>) =>
      `https://account.test${path}?token=${query.token}`,
    send: vi.fn(async (to: string, content: MailContent) => {
      sent.push({ to, content });
      return { messageId: '<m1@test>' };
    }),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const service = new AuthMailJobs(
    db as unknown as Database,
    jobs as unknown as JobQueue,
    tokens as unknown as AuthTokenService,
    mail as unknown as MailService,
    audit as unknown as AuditService,
  );
  service.onModuleInit();
  const run = (name: string) => registered.get(name)!({ userId: 'u1' }, JOB);
  return { run, tokens, sent, audit, mail };
}

const PENDING = {
  email: 'alice@example.com',
  displayName: 'Alice',
  locale: 'en-US',
  status: 'pending',
  deletedAt: null,
};

describe('AuthMailJobs（docs/architecture/backend/11-mail.md §4）', () => {
  it('啟用信：寄出當下簽發 token，連結帶原文，信裡的時數與 token 一致，稽核不含 token', async () => {
    const { run, tokens, sent, audit } = setup(PENDING);
    await expect(run(ACTIVATION_MAIL_JOB.name)).resolves.toEqual({ messageId: '<m1@test>' });

    expect(tokens.issue).toHaveBeenCalledWith('u1', 'activation');
    expect(sent[0]!.to).toBe('alice@example.com');
    expect(sent[0]!.content.subject).toBe('Activate your B2B System account');
    const text = await render(sent[0]!.content.body, { plainText: true });
    expect(text).toContain('https://account.test/setup?token=raw-token');
    expect(text).toContain('48 hours');

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mail.send',
        resourceId: 'u1',
        metadata: { template: 'auth.activation', jobId: 'job-1', messageId: '<m1@test>' },
      }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('raw-token');
  });

  it('啟用信：使用者已經不是 pending（例：已自行啟用）→ 不簽發、不寄', async () => {
    const { run, tokens, sent } = setup({ ...PENDING, status: 'active' });
    await expect(run(ACTIVATION_MAIL_JOB.name)).resolves.toEqual({ skipped: 'user_active' });
    expect(tokens.issue).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it('使用者不存在或已刪除 → 不寄', async () => {
    await expect(setup(undefined).run(PASSWORD_RESET_MAIL_JOB.name)).resolves.toEqual({
      skipped: 'user_not_found',
    });
    await expect(
      setup({ ...PENDING, deletedAt: new Date() }).run(PASSWORD_RESET_MAIL_JOB.name),
    ).resolves.toEqual({ skipped: 'user_not_found' });
  });

  it('重設密碼信：任何狀態都寄，連結指向 reset-password，依使用者語系', async () => {
    const { run, tokens, sent } = setup({ ...PENDING, status: 'inactive', locale: 'zh-TW' });
    await run(PASSWORD_RESET_MAIL_JOB.name);
    expect(tokens.issue).toHaveBeenCalledWith('u1', 'password_reset');
    expect(sent[0]!.content.subject).toBe('重設你的 B2B System 密碼');
    const text = await render(sent[0]!.content.body, { plainText: true });
    expect(text).toContain('https://account.test/reset-password?token=raw-token');
    expect(text).toContain('2 小時');
  });

  it('寄送失敗 → 拋出讓佇列重試，不寫稽核', async () => {
    const { run, mail, audit } = setup(PENDING);
    mail.send.mockRejectedValueOnce(new Error('SMTP 連線失敗'));
    await expect(run(ACTIVATION_MAIL_JOB.name)).rejects.toThrow('SMTP 連線失敗');
    expect(audit.record).not.toHaveBeenCalled();
  });
});
