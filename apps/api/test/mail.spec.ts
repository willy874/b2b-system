import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';

import { MailTransport } from '@/core/mail';
import type { MailMessage, SentMail } from '@/core/mail';
import { auditLogs } from '@/db/schema';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';

/** 收下所有寄出的信，測試從這裡取連結。 */
class RecordingMailTransport extends MailTransport {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<SentMail> {
    this.sent.push(message);
    return Promise.resolve({ messageId: `<${this.sent.length}@test>` });
  }

  to(email: string): MailMessage[] {
    return this.sent.filter((message) => message.to === email);
  }
}

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
const mailbox = new RecordingMailTransport();

const SUPER_ADMIN = { email: 'mail-root@example.com', password: 'RootPassword!2026' };
const NEW_PASSWORD = 'MailFlow!Pass2026';

function login(email: string, password: string) {
  return request(http).post('/auth/login').send({ email, password });
}

async function adminToken(): Promise<string> {
  const response = await login(SUPER_ADMIN.email, SUPER_ADMIN.password).expect(200);
  return (response.body as { data: { accessToken: string } }).data.accessToken;
}

/** worker 以輪詢取工作：等到這個收件人收到第 `count` 封信。 */
async function waitForMail(email: string, count = 1): Promise<MailMessage> {
  return vi.waitFor(
    () => {
      const messages = mailbox.to(email);
      expect(messages).toHaveLength(count);
      return messages[count - 1]!;
    },
    { timeout: 20_000, interval: 200 },
  );
}

function tokenIn(message: MailMessage, path: string): string {
  const match = new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`).exec(message.text);
  if (!match) throw new Error(`信裡找不到 ${path} 的連結：\n${message.text}`);
  return match[1]!;
}

describe('郵件寄送（docs/architecture/backend/11-mail.md）', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = inject('databaseUrl');
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;
    process.env.JOBS_WORKER_ENABLED = 'true';
    process.env.AUDIT_LOG_ARCHIVE_CRON = '';
    process.env.FILE_MAINTENANCE_CRON = '';
    process.env.AUTH_RATE_LIMIT = '1000';
    process.env.APP_PUBLIC_URL = 'https://editor.example.com';

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
    http = app.getHttpServer() as App;
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    for (const key of [
      'JOBS_WORKER_ENABLED',
      'AUDIT_LOG_ARCHIVE_CRON',
      'FILE_MAINTENANCE_CRON',
      'AUTH_RATE_LIMIT',
      'APP_PUBLIC_URL',
    ]) {
      delete process.env[key];
    }
  });

  it('管理員建立帳號 → 寄出啟用信 → 點連結設定密碼 → 可以登入', async () => {
    const token = await adminToken();
    const created = await request(http)
      .post('/users')
      .set('authorization', `Bearer ${token}`)
      .send({ email: 'new-member@example.com', displayName: '新成員', roleIds: [] })
      .expect(201);
    const userId = (created.body as { data: { id: string } }).data.id;

    const mail = await waitForMail('new-member@example.com');
    expect(mail.subject).toBe('啟用你的 B2B System 帳號');
    expect(mail.text).toContain('https://editor.example.com/auth/setup?token=');
    const setupToken = tokenIn(mail, '/auth/setup');

    await request(http)
      .post('/auth/setup')
      .send({ token: setupToken, password: NEW_PASSWORD })
      .expect(200);
    await login('new-member@example.com', NEW_PASSWORD).expect(200);

    // 稽核只記「寄了哪種信給誰」，不含 token
    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'mail.send'), eq(auditLogs.resourceId, userId)));
    expect(audit).toMatchObject({
      actorEmail: 'system',
      resourceName: 'new-member@example.com',
      metadata: expect.objectContaining({ template: 'auth.activation' }),
    });
    expect(JSON.stringify(audit!.metadata)).not.toContain(setupToken);
  });

  it('忘記密碼：一分鐘內重複申請只寄一封；用信裡的連結重設後舊密碼失效', async () => {
    const email = 'new-member@example.com';
    await request(http).post('/auth/forgot-password').send({ email }).expect(200);
    await request(http).post('/auth/forgot-password').send({ email }).expect(200);

    // 第 1 封是啟用信
    const mail = await waitForMail(email, 2);
    expect(mail.subject).toBe('重設你的 B2B System 密碼');
    const resetToken = tokenIn(mail, '/auth/reset-password');

    await request(http)
      .post('/auth/reset-password')
      .send({ token: resetToken, newPassword: `${NEW_PASSWORD}x` })
      .expect(200);
    await login(email, NEW_PASSWORD).expect(401);
    await login(email, `${NEW_PASSWORD}x`).expect(200);
    // 節流擋下的第二次申請不會晚一點才寄出
    expect(mailbox.to(email)).toHaveLength(2);
  });

  it('忘記密碼：不存在的 email 一樣回 200，但不寄信', async () => {
    const before = mailbox.sent.length;
    await request(http)
      .post('/auth/forgot-password')
      .send({ email: 'nobody@example.com' })
      .expect(200);
    expect(mailbox.sent).toHaveLength(before);
  });

  it('申請帳號被駁回 → 申請人收到結果與審核意見', async () => {
    await request(http)
      .post('/auth/register')
      .send({ email: 'applicant@example.com', displayName: '申請人', password: NEW_PASSWORD })
      .expect(202);
    const token = await adminToken();
    const list = await request(http)
      .get('/approvals?status=pending')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    const approval = (
      list.body as { data: { items: Array<{ id: string; requesterName: string }> } }
    ).data.items.find((item) => item.requesterName === 'applicant@example.com')!;

    await request(http)
      .post(`/approvals/${approval.id}/reject`)
      .set('authorization', `Bearer ${token}`)
      .send({ comment: '請用公司信箱申請' })
      .expect(200);

    const mail = await waitForMail('applicant@example.com');
    expect(mail.subject).toBe('你的帳號申請未通過');
    expect(mail.text).toContain('請用公司信箱申請');
  });
});
