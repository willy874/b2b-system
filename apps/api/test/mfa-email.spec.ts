import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { MailTransport } from '@/core/mail';
import type { MailMessage, SentMail } from '@/core/mail';
import { MfaChallengeDelivery } from '@/core/mfa';
import { mfaChallenges, users } from '@/db/schema';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { inTestTenant } from './tenant';

/** 收下所有寄出的信（同 mail.spec.ts）。 */
class RecordingMailTransport extends MailTransport {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<SentMail> {
    this.sent.push(message);
    return Promise.resolve({ messageId: `<${this.sent.length}@test>` });
  }

  codesTo(email: string): string[] {
    return this.sent
      .filter((message) => message.to === email)
      .map((message) => /^(\d{6}) 是你的驗證碼$/.exec(message.subject)?.[1])
      .filter((code): code is string => code !== undefined);
  }
}

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
const mailbox = new RecordingMailTransport();
const PASSWORD = 'Mfa-Email!Pass2026';

function dataOf<T>(response: request.Response): T {
  return (response.body as { data: T }).data;
}

function errorCode(response: request.Response): string | undefined {
  return (response.body as { error?: { code?: string } }).error?.code;
}

async function createUser(email: string): Promise<string> {
  const { hashPassword } = await import('@/modules/credential/password');
  const [user] = await db
    .insert(users)
    .values({
      email,
      displayName: email,
      passwordHash: await hashPassword(PASSWORD),
      status: 'active',
    })
    .returning({ id: users.id });
  return user!.id;
}

async function tokenOf(email: string): Promise<string> {
  const response = await request(http)
    .post('/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  return dataOf<{ accessToken: string }>(response).accessToken;
}

/** worker 以輪詢取工作：等到這個收件人收到第 `count` 封驗證碼信。 */
function waitForCode(email: string, count: number): Promise<string> {
  return vi.waitFor(
    () => {
      const codes = mailbox.codesTo(email);
      expect(codes).toHaveLength(count);
      return codes[count - 1]!;
    },
    { timeout: 20_000, interval: 200 },
  );
}

describe('MFA：Email 驗證碼（docs/architecture/backend/21-mfa.md §9.2）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = 'mfa-email-root@example.com';
    process.env.SUPER_ADMIN_PASSWORD = 'Quiet-Harbor-Lantern-26';
    process.env.JOBS_WORKER_ENABLED = 'true';
    process.env.AUDIT_LOG_ARCHIVE_CRON = '';
    process.env.FILE_MAINTENANCE_CRON = '';
    process.env.AUTH_RATE_LIMIT = '1000';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailTransport)
      .useValue(mailbox)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    http = await listenOnLoopback(app);
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    for (const key of [
      'JOBS_WORKER_ENABLED',
      'AUDIT_LOG_ARCHIVE_CRON',
      'FILE_MAINTENANCE_CRON',
      'AUTH_RATE_LIMIT',
    ]) {
      delete process.env[key];
    }
  });

  it('設定：開始時寄出驗證碼（碼不在工作資料、DB 只存 HMAC）；重寄在冷卻內回 429；重寄後舊碼失效', async () => {
    await createUser('email-enroll@example.com');
    const token = await tokenOf('email-enroll@example.com');
    const started = dataOf<{ factorId: string; challenge: { challengeId: string; hint: string } }>(
      await request(http)
        .post('/auth/mfa/factors')
        .set('authorization', `Bearer ${token}`)
        .send({ method: 'email' })
        .expect(200),
    );
    expect(started.challenge.hint).toBe('e***@example.com');
    const code = await waitForCode('email-enroll@example.com', 1);
    const [challenge] = await db
      .select()
      .from(mfaChallenges)
      .where(eq(mfaChallenges.id, started.challenge.challengeId));
    expect(JSON.stringify(challenge!.state)).not.toContain(code);
    expect(typeof challenge!.state.codeHash).toBe('string');

    const tooSoon = await request(http)
      .post(`/auth/mfa/factors/${started.factorId}/challenge`)
      .set('authorization', `Bearer ${token}`)
      .expect(429);
    expect(errorCode(tooSoon)).toBe('RATE_LIMITED');

    // 冷卻到期後重寄：新的 challenge 與新的碼
    await db
      .update(mfaChallenges)
      .set({ resendAfter: new Date(Date.now() - 1000) })
      .where(eq(mfaChallenges.id, started.challenge.challengeId));
    const resent = dataOf<{ challengeId: string }>(
      await request(http)
        .post(`/auth/mfa/factors/${started.factorId}/challenge`)
        .set('authorization', `Bearer ${token}`)
        .expect(200),
    );
    const newCode = await waitForCode('email-enroll@example.com', 2);
    const stale = await request(http)
      .post(`/auth/mfa/factors/${started.factorId}/confirm`)
      .set('authorization', `Bearer ${token}`)
      .send({ challengeId: started.challenge.challengeId, payload: { code } })
      .expect(400);
    // 重寄時舊的 challenge 已作廢
    expect(errorCode(stale)).toBe('AUTH_MFA_CHALLENGE_EXPIRED');
    await request(http)
      .post(`/auth/mfa/factors/${started.factorId}/confirm`)
      .set('authorization', `Bearer ${token}`)
      .send({ challengeId: resent.challengeId, payload: { code: newCode } })
      .expect(200);
  });

  it('同一個 challenge 錯 5 次作廢（之後對的碼也回 AUTH_MFA_CHALLENGE_EXPIRED）', async () => {
    await createUser('email-attempts@example.com');
    const token = await tokenOf('email-attempts@example.com');
    const started = dataOf<{ factorId: string; challenge: { challengeId: string } }>(
      await request(http)
        .post('/auth/mfa/factors')
        .set('authorization', `Bearer ${token}`)
        .send({ method: 'email' })
        .expect(200),
    );
    const code = await waitForCode('email-attempts@example.com', 1);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      // oxlint-disable-next-line no-await-in-loop -- 依序送出
      await request(http)
        .post(`/auth/mfa/factors/${started.factorId}/confirm`)
        .set('authorization', `Bearer ${token}`)
        .send({ challengeId: started.challenge.challengeId, payload: { code: wrong } })
        .expect(400);
    }
    const exhausted = await request(http)
      .post(`/auth/mfa/factors/${started.factorId}/confirm`)
      .set('authorization', `Bearer ${token}`)
      .send({ challengeId: started.challenge.challengeId, payload: { code } })
      .expect(400);
    expect(errorCode(exhausted)).toBe('AUTH_MFA_CHALLENGE_EXPIRED');
  });

  it('寄出前帳號已停用：寄信工作略過，不寄信', async () => {
    const userId = await createUser('email-disabled@example.com');
    const token = await tokenOf('email-disabled@example.com');
    const started = dataOf<{ challenge: { challengeId: string } }>(
      await request(http)
        .post('/auth/mfa/factors')
        .set('authorization', `Bearer ${token}`)
        .send({ method: 'email' })
        .expect(200),
    );
    await waitForCode('email-disabled@example.com', 1);
    await db.update(users).set({ status: 'inactive' }).where(eq(users.id, userId));
    // 工作重試（或重寄的工作）在停用之後才執行：經框架的入口確認帳號，直接略過
    const deliver = vi.fn();
    const result = await inTestTenant(app, () =>
      app
        .get(MfaChallengeDelivery)
        .deliver('tenant', userId, started.challenge.challengeId, deliver),
    );
    expect(result).toEqual({ delivered: false, reason: 'account_inactive' });
    expect(deliver).not.toHaveBeenCalled();
  });

  it('安全通知信：新增驗證方式時寄給本人', async () => {
    await vi.waitFor(
      () => {
        const notices = mailbox.sent.filter(
          (message) =>
            message.to === 'email-enroll@example.com' &&
            message.subject === '你的帳號安全設定有變更',
        );
        expect(notices.length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 20_000, interval: 200 },
    );
  });
});
