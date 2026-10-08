import { request } from '@playwright/test';

import { apiLogin, apiRequest } from '../helpers/api';
import { PLATFORM_URL } from '../helpers/auth';

/** 公告的內文是富文本：純文字每一行一個段落（docs/architecture/backend/19-announcement.md §9.2 D22）。 */
function richText(text: string) {
  return {
    type: 'doc',
    content: text
      .split('\n')
      .map((line) =>
        line
          ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
          : { type: 'paragraph' },
      ),
  };
}

/**
 * 導覽用的示範資料：全部經 API 建立（和使用者在畫面上做的事走同一條路，稽核、通知、背景工作都會跟著產生）。
 * 名稱刻意用領域中立的組織情境（docs/README.md §4）。
 */

type Body<T> = { data: T };

export interface DemoData {
  token: string;
  userIds: string[];
  roleId: string;
  groupId: string;
  serviceAccountId: string;
  webhookId: string;
  announcementId: string;
  approvalId: string | null;
  folderId: string;
  imageFileId: string | null;
}

async function call<T>(
  token: string,
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await apiRequest(token, method, path, data);
  if (response.status >= 300) {
    throw new Error(
      `${method.toUpperCase()} ${path} → ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  return (response.body as Body<T>)?.data;
}

/** 某些示範資料建不起來時不擋住整個導覽，只記下來。 */
async function attempt<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    console.warn(`[tour] 略過 ${label}：${(error as Error).message}`);
    return null;
  }
}

async function upload(
  token: string,
  folderId: string,
  name: string,
  contentType: string,
  content: Buffer,
): Promise<string> {
  const created = await call<{
    file: { id: string };
    upload: { url: string; headers?: Record<string, string> } | null;
  }>(token, 'post', '/files', { name, contentType, size: content.length, folderId });
  if (created.upload) {
    const context = await request.newContext();
    const put = await context.put(created.upload.url, {
      data: content,
      headers: created.upload.headers ?? { 'content-type': contentType },
    });
    await context.dispose();
    if (!put.ok()) throw new Error(`PUT ${name} → ${put.status()}`);
  }
  await call(token, 'post', `/files/${created.file.id}/complete`, {});
  return created.file.id;
}

export async function createDemoData(
  images: Array<{ name: string; content: Buffer }>,
): Promise<DemoData> {
  const token = await apiLogin('superAdmin');

  const users = await call<{ items: Array<{ id: string; email: string }> }>(
    token,
    'get',
    '/users?pageSize=100',
  );
  const devUsers = users.items.filter((user) => user.email.startsWith('dev'));
  const userIds = devUsers.map((user) => user.id);

  // ── 標籤
  const userTags: string[] = [];
  for (const [name, color] of [
    ['重要客戶窗口', 'brand'],
    ['合約到期', 'warning'],
    ['外部顧問', 'neutral'],
  ] as const) {
    const tag = await attempt(`標籤 ${name}`, () =>
      call<{ id: string }>(token, 'post', '/tags', { scope: 'user', name, color }),
    );
    if (tag) userTags.push(tag.id);
  }
  const fileTags: string[] = [];
  for (const [name, color] of [
    ['設計稿', 'brand'],
    ['已核准', 'success'],
    ['待修改', 'warning'],
  ] as const) {
    const tag = await attempt(`標籤 ${name}`, () =>
      call<{ id: string }>(token, 'post', '/tags', { scope: 'file', name, color }),
    );
    if (tag) fileTags.push(tag.id);
  }
  for (const [index, userId] of userIds.slice(0, 6).entries()) {
    await attempt('指派標籤', () =>
      call(token, 'put', `/tags/assignments/user/${userId}`, {
        tagIds: userTags.slice(0, (index % 3) + 1),
      }),
    );
  }

  // ── 角色與版本紀錄：建立 → 改說明 → 加權限，留下三個版本
  const role = await call<{ id: string }>(token, 'post', '/roles', {
    name: '營運專員',
    description: '處理日常營運：檢視人員與稽核紀錄',
    permissionKeys: ['user:read', 'auditLog:read'],
  });
  const roleDetail = await call<{ version: number }>(token, 'get', `/roles/${role.id}`);
  await call(token, 'patch', `/roles/${role.id}`, {
    description: '處理日常營運：檢視人員、檔案與稽核紀錄，可審核申請',
    version: roleDetail.version,
  });
  await call(token, 'patch', `/roles/${role.id}/permissions`, {
    add: ['file:read', 'approval:read', 'approval:review'],
    remove: [],
  });

  // ── 群組：讓營運專員角色掛在一個群組上，explain 才看得到「使用者 → 群組 → 角色」
  const group = await call<{ id: string }>(token, 'post', '/groups', {
    name: '營運中心',
    description: '值班與營運支援',
  });
  await call(token, 'patch', `/groups/${group.id}/members`, {
    add: userIds.slice(0, 4).map((id) => ({ type: 'user', id })),
  });
  await call(token, 'patch', `/groups/${group.id}/roles`, { add: [role.id] });

  // ── 服務帳號與 token
  const serviceAccount = await call<{ id: string }>(token, 'post', '/service-accounts', {
    name: '報表同步',
  });
  await attempt('服務帳號 token', () =>
    call(token, 'post', `/service-accounts/${serviceAccount.id}/tokens`, {
      name: '每日匯出',
      expiresInDays: 90,
      scopes: null,
    }),
  );
  await attempt('第二個服務帳號', () =>
    call(token, 'post', '/service-accounts', { name: 'CRM 整合' }),
  );

  // ── Webhook：目標是不存在的服務，投遞會失敗、重試，管理頁看得到紀錄
  const events = await call<{ items: Array<{ type: string }> }>(token, 'get', '/webhooks/events');
  const eventKeys = events.items.map((event) => event.type);
  const created = await call<{ webhook: { id: string } }>(token, 'post', '/webhooks', {
    name: 'CRM 同步',
    urls: ['https://hooks.example.com/b2b/users'],
    events: eventKeys.filter((key) => key.startsWith('user.')).slice(0, 4),
  });

  // ── 檔案：資料夾、圖片（用導覽前一輪的截圖）、文字檔、資料夾授權給群組
  const folder = await call<{ id: string }>(token, 'post', '/file-folders', {
    name: '行銷素材',
    parentId: null,
  });
  for (const name of ['合約', '產品型錄', '內部文件']) {
    await attempt(`資料夾 ${name}`, () =>
      call(token, 'post', '/file-folders', { name, parentId: null }),
    );
  }
  await attempt('資料夾授權', () =>
    call(token, 'put', `/file-folders/${folder.id}/grants`, {
      subjectType: 'group',
      subjectId: group.id,
      level: 'contributor',
    }),
  );
  let imageFileId: string | null = null;
  for (const [index, image] of images.entries()) {
    const id = await attempt(`上傳 ${image.name}`, () =>
      upload(token, folder.id, image.name, 'image/jpeg', image.content),
    );
    if (!id) continue;
    imageFileId ??= id;
    await attempt('檔案標籤', () =>
      call(token, 'put', `/tags/assignments/file/${id}`, {
        tagIds: [fileTags[0], fileTags[1 + (index % 2)]].filter(Boolean),
      }),
    );
  }
  await attempt('上傳文字檔', () =>
    upload(
      token,
      folder.id,
      '上架檢查清單.txt',
      'text/plain',
      Buffer.from('1. 確認素材授權\n2. 檢查文案\n3. 排程上架\n'),
    ),
  );

  // ── 外部 IdP
  await attempt('外部 IdP', () =>
    call(token, 'post', '/identity-providers', {
      name: '合作夥伴 SSO',
      issuer: 'https://login.partner.example.com',
      clientId: 'b2b-system',
      clientSecret: 'demo-client-secret',
      unmatchedPolicy: 'reject',
      domains: [{ domain: 'partner.example.com', ssoOnly: false }],
    }),
  );

  // ── 註冊申請（走 apps/platform 的網域，以 X-Tenant 指定租戶）
  const register = await request.newContext();
  for (const [email, displayName, reason] of [
    ['lin.yating@partner.example.com', '林雅婷', '合作專案的窗口，需要檢視共用資料夾'],
    ['chen.weijie@partner.example.com', '陳偉傑', '新進營運人員'],
  ]) {
    await attempt(`註冊 ${email}`, async () => {
      const response = await register.post(`${PLATFORM_URL}/api/auth/register`, {
        headers: { 'x-tenant': 'default' },
        data: { email, displayName, password: 'Spring!Harbor2026', reason },
      });
      if (response.status() !== 202)
        throw new Error(`${response.status()} ${await response.text()}`);
    });
  }
  await register.dispose();
  const approvals = await attempt('審批列表', () =>
    call<{ items: Array<{ id: string }> }>(token, 'get', '/approvals?pageSize=20'),
  );

  // ── 公告：一則立即發給全體、一則每週的草稿
  const announcement = await call<{ id: string; version: number }>(
    token,
    'post',
    '/announcements',
    {
      title: '十月系統維護通知',
      body: richText(
        '10 月 18 日（六）22:00–23:00 進行例行維護，期間後台暫停服務。請提前儲存手上的編輯。',
      ),
      audience: { all: true },
      trigger: { kind: 'immediate' },
    },
  );
  await call(token, 'post', `/announcements/${announcement.id}/publish`, {
    version: announcement.version,
  });
  await attempt('週期公告', () =>
    call(token, 'post', '/announcements', {
      title: '每週一提醒：更新營運週報',
      body: richText('請在週一中午前把上週的營運數字更新到共用資料夾。'),
      audience: { all: true },
      trigger: {
        kind: 'recurring',
        frequency: 'weekly',
        interval: 1,
        weekdays: [1],
        time: '09:00',
        startsOn: '2026-10-05',
      },
    }),
  );

  // ── 回收桶：刪掉一位使用者、一個角色
  await attempt('刪除使用者', () => call(token, 'delete', `/users/${userIds[userIds.length - 1]}`));
  const tempRole = await attempt('暫時角色', () =>
    call<{ id: string }>(token, 'post', '/roles', {
      name: '舊專案協作者',
      permissionKeys: ['user:read'],
    }),
  );
  if (tempRole) await attempt('刪除角色', () => call(token, 'delete', `/roles/${tempRole.id}`));

  return {
    token,
    userIds,
    roleId: role.id,
    groupId: group.id,
    serviceAccountId: serviceAccount.id,
    webhookId: created.webhook.id,
    announcementId: announcement.id,
    approvalId: approvals?.items[0]?.id ?? null,
    folderId: folder.id,
    imageFileId,
  };
}
