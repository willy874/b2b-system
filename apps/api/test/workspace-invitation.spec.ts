import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';

import { MailTransport } from '@/core/mail';
import type { MailMessage, SentMail } from '@/core/mail';
import { ObjectStorage } from '@/core/storage';
import {
  auditLogs,
  permissions,
  rolePermissions,
  roles,
  users,
  workspaceInvitations,
} from '@/db/schema';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { InMemoryObjectStorage } from './in-memory-object-storage';
import { assignRoles, defaultWorkspaceId, isMember, roleIdOf, workspacePath } from './workspace';

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

const SUPER_ADMIN = { email: 'inv-root@example.com', password: 'RootPassword!2026' };
/** 工作區管理員，同時是平台管理員（有 user:create）：可以邀請沒有帳號的 email */
const PLATFORM_WS_ADMIN = { email: 'inv-padmin@example.com', password: 'PAdminPassword!2026' };
/** 工作區管理員，沒有平台的 user:create：只能邀請已有帳號的人 */
const WS_ADMIN = { email: 'inv-wsadmin@example.com', password: 'WsAdminPassword!2026' };
/** 一般成員：沒有 workspaceMember:create */
const MEMBER = { email: 'inv-member@example.com', password: 'MemberPassword!2026' };
/** 已有帳號、還不是成員 */
const OUTSIDER = { email: 'inv-outsider@example.com', password: 'OutsiderPassword!2026' };
const NEW_PASSWORD = 'InviteFlow!Pass2026';

let defaultWs = '';
const roleIds: Record<string, string> = {};

async function login(credentials: { email: string; password: string }): Promise<string> {
  const response = await request(http).post('/auth/login').send(credentials).expect(200);
  return (response.body as { data: { accessToken: string } }).data.accessToken;
}

function api(token: string) {
  const auth = (req: request.Test) => req.set('authorization', `Bearer ${token}`);
  return {
    get: (path: string) => auth(request(http).get(path)),
    post: (path: string, body: object) => auth(request(http).post(path)).send(body),
    delete: (path: string) => auth(request(http).delete(path)),
  };
}

function errorCode(response: request.Response): string | undefined {
  return (response.body as { error?: { code?: string } }).error?.code;
}

async function createActiveUser(
  credentials: { email: string; password: string },
  roleSlugs: string[],
  workspaceId?: string,
): Promise<string> {
  const { hashPassword } = await import('@/modules/auth/password');
  const [user] = await db
    .insert(users)
    .values({
      email: credentials.email,
      displayName: credentials.email,
      passwordHash: await hashPassword(credentials.password),
      status: 'active',
    })
    .returning();
  if (!user) throw new Error('建立使用者失敗');
  const ids = await Promise.all(roleSlugs.map((slug) => roleIdOf(db, slug)));
  await assignRoles(db, user.id, ids, workspaceId);
  return user.id;
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

function tokenIn(message: MailMessage): string {
  const match = /\/auth\/invitation\?token=([A-Za-z0-9_-]+)/.exec(message.text);
  if (!match) throw new Error(`信裡找不到邀請連結：\n${message.text}`);
  return match[1]!;
}

function invite(
  token: string,
  email: string,
  roleSlugs: string[] = ['workspace-member'],
): request.Test {
  return api(token).post(`${workspacePath(defaultWs)}/invitations`, {
    email,
    roleIds: roleSlugs.map((slug) => roleIds[slug]!),
  });
}

describe('工作區的 Email 邀請（docs/adr/0018-workspace-tenancy.md D14）', () => {
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
    defaultWs = await defaultWorkspaceId(db);
    const slugs = ['workspace-admin', 'workspace-member', 'workspace-viewer'];
    const found = await Promise.all(slugs.map((slug) => roleIdOf(db, slug)));
    slugs.forEach((slug, index) => (roleIds[slug] = found[index]!));

    await createActiveUser(PLATFORM_WS_ADMIN, ['admin', 'workspace-admin'], defaultWs);
    await createActiveUser(WS_ADMIN, ['member', 'workspace-admin'], defaultWs);
    await createActiveUser(MEMBER, ['member', 'workspace-member'], defaultWs);
    await createActiveUser(OUTSIDER, ['member']);

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailTransport)
      .useValue(mailbox)
      .overrideProvider(ObjectStorage)
      .useValue(new InMemoryObjectStorage())
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

  it('沒有帳號：邀請 → 寄信 → 設定密碼建立已啟用帳號 → 成為成員並取得角色 → 可以登入', async () => {
    const admin = await login(PLATFORM_WS_ADMIN);
    const created = await invite(admin, 'artist@example.com').expect(201);
    expect((created.body as { data: unknown }).data).toMatchObject({
      email: 'artist@example.com',
      hasAccount: false,
      isExpired: false,
      roles: [{ slug: 'workspace-member' }],
    });

    const mail = await waitForMail('artist@example.com');
    expect(mail.subject).toBe('邀請你加入 B2B System 工作區：預設工作區');
    expect(mail.text).toContain('https://editor.example.com/auth/invitation?token=');
    const token = tokenIn(mail);

    const preview = await request(http)
      .get('/workspace-invitations/preview')
      .query({ token })
      .expect(200);
    expect((preview.body as { data: unknown }).data).toMatchObject({
      email: 'artist@example.com',
      workspaceName: '預設工作區',
      inviterName: PLATFORM_WS_ADMIN.email,
      hasAccount: false,
    });

    const accepted = await request(http)
      .post('/workspace-invitations/signup')
      .send({ token, displayName: '外包美術', password: NEW_PASSWORD })
      .expect(200);
    expect((accepted.body as { data: unknown }).data).toMatchObject({
      email: 'artist@example.com',
      workspace: { id: defaultWs, slug: 'default' },
    });

    const [user] = await db.select().from(users).where(eq(users.email, 'artist@example.com'));
    expect(user).toMatchObject({ status: 'active', displayName: '外包美術' });
    expect(await isMember(db, defaultWs, user!.id)).toBe(true);

    const artist = await login({ email: 'artist@example.com', password: NEW_PASSWORD });
    const me = await api(artist)
      .get(`${workspacePath(defaultWs)}/me`)
      .expect(200);
    const body = me.body as { data: { roles: { slug: string }[] } };
    expect(body.data.roles.map((role) => role.slug)).toEqual(['workspace-member']);

    // 連結只能用一次
    const reused = await request(http)
      .post('/workspace-invitations/signup')
      .send({ token, displayName: 'x', password: NEW_PASSWORD })
      .expect(400);
    expect(errorCode(reused)).toBe('WORKSPACE_INVITATION_INVALID');

    const actions = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.resourceName, 'artist@example.com'));
    expect(actions.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'workspaceInvitation.create',
        'mail.send',
        'user.create',
        'workspaceInvitation.accept',
      ]),
    );
  });

  it('已有帳號：登入後接受；登入的帳號必須是受邀的 email', async () => {
    const admin = await login(WS_ADMIN);
    await invite(admin, OUTSIDER.email, ['workspace-viewer']).expect(201);
    const token = tokenIn(await waitForMail(OUTSIDER.email));

    const preview = await request(http)
      .get('/workspace-invitations/preview')
      .query({ token })
      .expect(200);
    expect((preview.body as { data: { hasAccount: boolean } }).data.hasAccount).toBe(true);

    // 沒有帳號的流程不能用來覆蓋既有帳號
    const signup = await request(http)
      .post('/workspace-invitations/signup')
      .send({ token, displayName: 'x', password: NEW_PASSWORD })
      .expect(409);
    expect(errorCode(signup)).toBe('WORKSPACE_INVITATION_ACCOUNT_EXISTS');

    // 轉寄的連結：別人登入後不能接受
    const mismatch = await api(await login(MEMBER))
      .post('/workspace-invitations/accept', { token })
      .expect(403);
    expect(errorCode(mismatch)).toBe('WORKSPACE_INVITATION_EMAIL_MISMATCH');

    const outsider = await login(OUTSIDER);
    await api(outsider).post('/workspace-invitations/accept', { token }).expect(200);
    const me = await api(outsider)
      .get(`${workspacePath(defaultWs)}/me`)
      .expect(200);
    const body = me.body as { data: { roles: { slug: string }[] } };
    expect(body.data.roles.map((role) => role.slug)).toEqual(['workspace-viewer']);
  });

  it('沒有平台的 user:create 不能邀請沒有帳號的 email', async () => {
    const response = await invite(await login(WS_ADMIN), 'nobody@example.com').expect(403);
    expect(errorCode(response)).toBe('WORKSPACE_INVITATION_USER_CREATE_REQUIRED');
  });

  it('已經是成員 → WORKSPACE_MEMBER_DUPLICATE；沒有 workspaceMember:create → 403', async () => {
    const duplicate = await invite(await login(WS_ADMIN), MEMBER.email).expect(409);
    expect(errorCode(duplicate)).toBe('WORKSPACE_MEMBER_DUPLICATE');
    await invite(await login(MEMBER), 'someone@example.com').expect(403);
  });

  it('邀請的角色受反提權限制；只能邀請工作區角色', async () => {
    // 只能邀請、沒有檔案權限的人：不能邀請帶 file:access 的 workspace-member
    const [inviterRole] = await db
      .insert(roles)
      .values({ slug: 'ws-inviter', name: '邀請人', scope: 'workspace' })
      .returning();
    const keys = await db
      .select()
      .from(permissions)
      .where(inArray(permissions.key, ['workspaceMember:read', 'workspaceMember:create']));
    await db
      .insert(rolePermissions)
      .values(keys.map((key) => ({ roleId: inviterRole!.id, permissionId: key.id })));
    const inviter = { email: 'inv-inviter@example.com', password: 'InviterPassword!2026' };
    await createActiveUser(inviter, ['member', 'ws-inviter'], defaultWs);
    await createActiveUser({ email: 'inv-target@example.com', password: OUTSIDER.password }, []);

    const escalation = await invite(await login(inviter), 'inv-target@example.com').expect(403);
    expect(errorCode(escalation)).toBe('AUTHZ_ESCALATION');

    const mismatch = await api(await login(PLATFORM_WS_ADMIN))
      .post(`${workspacePath(defaultWs)}/invitations`, {
        email: 'inv-target@example.com',
        roleIds: [await roleIdOf(db, 'member')],
      })
      .expect(422);
    expect(errorCode(mismatch)).toBe('ROLE_SCOPE_MISMATCH');
  });

  it('重新邀請會撤銷舊的：舊信的連結失效；撤銷後連結也失效', async () => {
    const admin = await login(PLATFORM_WS_ADMIN);
    await invite(admin, 'twice@example.com').expect(201);
    const first = tokenIn(await waitForMail('twice@example.com'));
    const second = await invite(admin, 'twice@example.com').expect(201);
    const secondToken = tokenIn(await waitForMail('twice@example.com', 2));

    const stale = await request(http)
      .get('/workspace-invitations/preview')
      .query({ token: first })
      .expect(400);
    expect(errorCode(stale)).toBe('WORKSPACE_INVITATION_INVALID');

    const list = await api(admin)
      .get(`${workspacePath(defaultWs)}/invitations`)
      .expect(200);
    const items = (list.body as { data: { items: { email: string }[] } }).data.items;
    expect(items.filter((item) => item.email === 'twice@example.com')).toHaveLength(1);

    const id = (second.body as { data: { id: string } }).data.id;
    await api(admin)
      .delete(`${workspacePath(defaultWs)}/invitations/${id}`)
      .expect(204);
    await request(http)
      .get('/workspace-invitations/preview')
      .query({ token: secondToken })
      .expect(400);
    const again = await api(admin)
      .delete(`${workspacePath(defaultWs)}/invitations/${id}`)
      .expect(404);
    expect(errorCode(again)).toBe('WORKSPACE_INVITATION_NOT_FOUND');
  });

  it('過期的邀請不能接受，但仍列在清單中（標示已過期）', async () => {
    const admin = await login(PLATFORM_WS_ADMIN);
    const created = await invite(admin, 'late@example.com').expect(201);
    const token = tokenIn(await waitForMail('late@example.com'));
    const id = (created.body as { data: { id: string } }).data.id;
    await db
      .update(workspaceInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(workspaceInvitations.id, id));

    const expired = await request(http)
      .get('/workspace-invitations/preview')
      .query({ token })
      .expect(400);
    expect(errorCode(expired)).toBe('WORKSPACE_INVITATION_INVALID');

    const list = await api(admin)
      .get(`${workspacePath(defaultWs)}/invitations`)
      .expect(200);
    const items = (list.body as { data: { items: { id: string; isExpired: boolean }[] } }).data
      .items;
    expect(items.find((item) => item.id === id)?.isExpired).toBe(true);
  });
});
