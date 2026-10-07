import { expect, test } from '@playwright/test';
import type { Browser, Locator, Page } from '@playwright/test';

import {
  expectIdpLogin,
  login,
  loginAndWaitForHome,
  loginPlatform,
  PLATFORM_URL,
} from '../helpers/auth';
import { getByTestIdAndValue } from '../helpers/selectors';
import { createDemoData } from './demo-data';
import type { DemoData } from './demo-data';
import { shoot } from './shoot';

/**
 * 功能導覽的劇本（docs/overview/05-feature-tour.md）。每一張圖是一個 `scene`：
 * 某一張拍不到時記下來、繼續拍下一張，最後一起報告——不讓一個畫面的改版擋住整份導覽的更新。
 */

test.describe.configure({ mode: 'serial' });

const failures: string[] = [];
let demo: DemoData;

async function scene(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    failures.push(`${name}：${(error as Error).message.split('\n')[0]}`);
  }
}

async function open(page: Page, path: string, testId: string): Promise<Locator> {
  await page.goto(path);
  const root = page.getByTestId(testId);
  await expect(root).toBeVisible();
  return root;
}

/** 樹狀圖預設縮到整張放得下，字太小：滑到某個節點上（同時標出它的路徑）再以滾輪放大。 */
async function zoomInto(page: Page, node: Locator): Promise<void> {
  await node.hover();
  for (let step = 0; step < 4; step += 1) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(150);
  }
  await node.hover();
  await page.waitForTimeout(600);
}

/** 檔案管理器裡的示範圖片：用瀏覽器畫幾張不同色調的「產品卡」，不必在 repo 放圖檔。 */
async function renderDemoImages(
  browser: Browser,
): Promise<Array<{ name: string; content: Buffer }>> {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const cards = [
    ['春季型錄封面.jpg', '#1767c2', '#7fb4f0', '春季型錄'],
    ['產品主視覺-A.jpg', '#1d7a46', '#8fd6ad', '主視覺 A'],
    ['產品主視覺-B.jpg', '#a4551a', '#f0bd8f', '主視覺 B'],
    ['活動橫幅.jpg', '#6b3fa0', '#c6a6ee', '活動橫幅'],
    ['門市陳列參考.jpg', '#0f6b73', '#86d3d9', '門市陳列'],
    ['社群貼文素材.jpg', '#a02a4a', '#f09ab2', '社群貼文'],
  ] as const;
  const images = [];
  for (const [name, from, to, title] of cards) {
    await page.setContent(
      `<body style="margin:0;height:100vh;display:grid;place-items:center;background:linear-gradient(135deg,${from},${to});font:700 72px system-ui;color:white">${title}</body>`,
    );
    images.push({ name, content: await page.screenshot({ type: 'jpeg', quality: 85 }) });
  }
  await page.close();
  return images;
}

test.afterAll(() => {
  if (failures.length > 0) console.warn(`[tour] 沒拍到的畫面：\n  ${failures.join('\n  ')}`);
});

test('準備示範資料', async ({ browser }) => {
  demo = await createDemoData(await renderDemoImages(browser));
});

test('登入與首頁', async ({ page, browser }) => {
  await scene('login', async () => {
    await page.goto('/auth/login');
    await expectIdpLogin(page);
    await shoot(page, 'login');
  });
  await scene('register', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const register = await context.newPage();
    await register.goto(`${PLATFORM_URL}/register?tenant=default`);
    await expect(register.getByTestId('register-email')).toBeVisible();
    await shoot(register, 'register');
    await context.close();
  });
  await login(page, 'superAdmin');
  await expect(page.getByTestId('home-page')).toBeVisible();
  await scene('home', () => shoot(page, 'home'));
  await scene('notification-bell', async () => {
    await page.getByTestId('notification-bell').click();
    await expect(page.getByTestId('notification-panel')).toBeVisible();
    await shoot(page, 'notification-bell');
    await page.keyboard.press('Escape');
  });
});

test('人員與權限', async ({ page }) => {
  await loginAndWaitForHome(page, 'superAdmin');

  await scene('user-list', async () => {
    await open(page, '/user', 'user-list-page');
    await shoot(page, 'user-list');
  });
  await scene('user-batch', async () => {
    const rows = page.getByTestId('table-select-row');
    for (const index of [9, 10, 11]) await rows.nth(index).check();
    await expect(page.getByTestId('batch-action-bar')).toBeVisible();
    await shoot(page, 'user-batch');
    await page.getByTestId('batch-action-bar-clear').click();
  });
  await scene('user-create', async () => {
    const dialog = await open(page, '/user/create', 'user-create-dialog');
    await dialog.getByTestId('user-email-input').fill('wang.mei@example.com');
    await dialog.getByTestId('user-display-name-input').fill('王美玲');
    await shoot(page, 'user-create');
  });
  await scene('user-detail-explain', async () => {
    const dialog = await open(page, `/user/${demo.userIds[0]}`, 'user-detail-dialog');
    await dialog.getByTestId('user-permission-sources-show').click();
    await expect(page.getByTestId('permission-source-list')).toBeVisible();
    await page.getByTestId('permission-source').first().click();
    await expect(page.getByTestId('permission-source-viewer')).toBeVisible();
    await shoot(page, 'user-detail-explain');
  });
  await scene('user-tag-assign', async () => {
    const dialog = await open(page, `/user/${demo.userIds[1]}`, 'user-detail-dialog');
    await dialog.getByTestId('user-tag-edit-button').click();
    await expect(page.getByTestId('tag-assign-dialog')).toBeVisible();
    await shoot(page, 'user-tag-assign');
  });

  await scene('role-list', async () => {
    await open(page, '/role', 'role-list-page');
    await shoot(page, 'role-list');
  });
  await scene('role-detail', async () => {
    await open(page, `/role/${demo.roleId}`, 'role-detail-dialog');
    await shoot(page, 'role-detail');
  });
  await scene('role-permission', async () => {
    const dialog = await open(page, `/role/${demo.roleId}/permission`, 'role-permission-dialog');
    const canvas = dialog.getByTestId('tree-editor-canvas');
    if (!(await canvas.isVisible()))
      await dialog.getByTestId('role-permission-tree-toggle').click();
    await expect(canvas).toBeVisible();
    await canvas.scrollIntoViewIfNeeded();
    await zoomInto(page, getByTestIdAndValue(dialog, 'role-permission-node', 'approval:review'));
    await shoot(page, 'role-permission');
  });
  await scene('role-revision', async () => {
    const dialog = await open(page, `/role/${demo.roleId}/revision`, 'role-revision-dialog');
    await getByTestIdAndValue(dialog, 'role-revision-item', '1').click();
    await expect(dialog.getByTestId('role-revision-diff')).toBeVisible();
    await shoot(page, 'role-revision');
  });
  await scene('role-create', async () => {
    const dialog = await open(page, '/role/create', 'role-create-dialog');
    await dialog.getByTestId('role-name-input').fill('門市主管');
    await shoot(page, 'role-create');
  });

  await scene('group-list', async () => {
    await open(page, '/group', 'group-list-page');
    await shoot(page, 'group-list');
  });
  await scene('group-detail', async () => {
    await open(page, `/group/${demo.groupId}`, 'group-detail-dialog');
    await shoot(page, 'group-detail');
  });

  await scene('permission-list', async () => {
    await open(page, '/permission', 'permission-list-page');
    await shoot(page, 'permission-list');
  });
  await scene('permission-tree', async () => {
    await open(page, '/permission?view=tree&key=file:delete', 'permission-list-page');
    await expect(page.getByTestId('tree-editor-canvas')).toBeVisible();
    await zoomInto(page, getByTestIdAndValue(page, 'permission-node', 'file:delete'));
    await shoot(page, 'permission-tree');
  });

  await scene('service-account-list', async () => {
    await open(page, '/service-account', 'service-account-list-page');
    await shoot(page, 'service-account-list');
  });
  await scene('service-account-token', async () => {
    const dialog = await open(
      page,
      `/service-account/${demo.serviceAccountId}`,
      'service-account-detail-dialog',
    );
    await shoot(page, 'service-account-detail');
    await dialog.getByTestId('service-account-token-create-button').click();
    const create = page.getByTestId('api-token-create-dialog');
    await create.getByTestId('api-token-name-input').fill('BI 儀表板');
    await create.getByTestId('api-token-create-submit').click();
    await expect(page.getByTestId('api-token-value')).toBeVisible();
    await shoot(page, 'service-account-token-created');
    await page.getByTestId('api-token-done').click();
  });

  await scene('forbidden', async () => {
    // 一般成員直接打開建立角色的網址（另一個 context，不影響上面的 session）
    const context = await page
      .context()
      .browser()!
      .newContext({ viewport: { width: 1440, height: 900 } });
    const member = await context.newPage();
    await member.goto('/role/create');
    await expectIdpLogin(member);
    await member.getByTestId('login-email').fill('e2e-member@dev.local');
    await member.getByTestId('login-password').fill('E2E!Password123');
    await member.getByTestId('login-submit').click();
    await expect(member).toHaveURL(/\/role\/create/);
    await member.waitForTimeout(1000);
    await shoot(member, 'forbidden');
    await context.close();
  });
});

test('資料與內容', async ({ page }) => {
  await loginAndWaitForHome(page, 'superAdmin');

  await scene('file-manager', async () => {
    await page.goto(`/file?folder=${demo.folderId}`);
    await expect(page.getByTestId('file-manager-page')).toBeVisible();
    await expect(page.locator('[data-testid="file-item"]').first()).toBeVisible();
    await page.waitForTimeout(1500);
    await shoot(page, 'file-folder');
  });
  await scene('file-list-view', async () => {
    await getByTestIdAndValue(page, 'file-view-mode', 'list').click();
    await page.waitForTimeout(500);
    await shoot(page, 'file-list-view');
    await getByTestIdAndValue(page, 'file-view-mode', 'grid').click();
  });
  await scene('file-share', async () => {
    await page.getByTestId('file-share-button').click();
    await expect(page.getByTestId('file-share-dialog')).toBeVisible();
    await shoot(page, 'file-share');
    await page.keyboard.press('Escape');
  });
  await scene('file-preview', async () => {
    if (!demo.imageFileId) throw new Error('沒有圖片');
    await page.goto(`/file?folder=${demo.folderId}&preview=${demo.imageFileId}`);
    await expect(page.getByTestId('file-lightbox')).toBeVisible();
    await page.waitForTimeout(1200);
    await shoot(page, 'file-preview');
  });

  await scene('approval-list', async () => {
    await open(page, '/approval', 'approval-list-page');
    await shoot(page, 'approval-list');
  });
  await scene('approval-detail', async () => {
    if (!demo.approvalId) throw new Error('沒有申請');
    await open(page, `/approval/${demo.approvalId}`, 'approval-detail-dialog');
    await shoot(page, 'approval-detail');
  });

  await scene('tag-list', async () => {
    await open(page, '/tag?scope=user', 'tag-list-page');
    await shoot(page, 'tag-list');
  });
});

test('稽核、回收桶、背景工作、設定', async ({ page }) => {
  await loginAndWaitForHome(page, 'superAdmin');

  await scene('audit-log', async () => {
    await open(page, '/audit-log', 'audit-log-page');
    await shoot(page, 'audit-log');
  });
  await scene('audit-log-expanded', async () => {
    await open(page, '/audit-log?resourceType=role', 'audit-log-page');
    await page.getByTestId('audit-log-expand').first().click();
    await expect(page.getByTestId('audit-log-detail')).toBeVisible();
    await shoot(page, 'audit-log-expanded');
  });
  await scene('audit-log-filter', async () => {
    await open(page, '/audit-log', 'audit-log-page');
    await page.getByTestId('filter-bar-trigger').click();
    await expect(page.getByTestId('filter-bar-popup')).toBeVisible();
    await shoot(page, 'audit-log-filter');
    await page.keyboard.press('Escape');
  });

  await scene('trash', async () => {
    await open(page, '/trash?type=user', 'trash-page');
    await shoot(page, 'trash');
  });
  await scene('trash-role', async () => {
    await open(page, '/trash?type=role', 'trash-page');
    await shoot(page, 'trash-role');
  });

  await scene('job', async () => {
    await open(page, '/job', 'job-page');
    await shoot(page, 'job');
  });
  await scene('job-detail', async () => {
    const table = page.getByTestId('job-table');
    await table.scrollIntoViewIfNeeded();
    await page.locator('[data-testid="job-expand"]').first().click();
    const detail = page.getByTestId('job-detail');
    await expect(detail).toBeVisible();
    // 詳情貼著畫面底部，上面留著展開的那一列與其他工作
    await detail.evaluate((element) => element.scrollIntoView({ block: 'end' }));
    await shoot(page, 'job-detail');
  });

  await scene('setting', async () => {
    await open(page, '/system/settings', 'setting-page');
    await shoot(page, 'setting');
  });
  await scene('identity-provider', async () => {
    await open(page, '/identity-provider', 'identity-provider-page');
    await shoot(page, 'identity-provider');
    await page.getByTestId('identity-provider-create-button').click();
    await expect(page.getByTestId('identity-provider-form-dialog')).toBeVisible();
    await shoot(page, 'identity-provider-form');
  });
});

test('通知、公告、Webhook', async ({ page }) => {
  await loginAndWaitForHome(page, 'superAdmin');

  await scene('notification-list', async () => {
    await open(page, '/notification', 'notification-list-page');
    await shoot(page, 'notification-list');
  });
  await scene('notification-events', async () => {
    await open(page, '/system/notification-events', 'notification-event-page');
    await shoot(page, 'notification-events');
  });
  await scene('notification-overview', async () => {
    await open(page, '/notification/all', 'notification-overview-page');
    await shoot(page, 'notification-overview');
  });

  await scene('announcement-list', async () => {
    await open(page, '/announcement', 'announcement-list-page');
    await shoot(page, 'announcement-list');
  });
  await scene('announcement-create', async () => {
    const dialog = await open(page, '/announcement/create', 'announcement-create-dialog');
    await dialog.getByTestId('announcement-title-input').fill('新版請假流程上線');
    await dialog
      .getByTestId('announcement-body-input')
      .fill('自下週一起，請假改由後台送出申請，主管在通知中心審核。');
    await dialog.getByTestId('announcement-audience-all').click();
    await expect(dialog.getByTestId('announcement-audience-count')).not.toContainText(' 0 ');
    await shoot(page, 'announcement-create');
  });
  await scene('announcement-detail', async () => {
    await open(page, `/announcement/${demo.announcementId}`, 'announcement-detail-dialog');
    await shoot(page, 'announcement-detail');
  });
  await scene('announcement-message', async () => {
    // 發送者自己不在收件人裡：換一般成員，從鈴鐺點進全文
    const context = await page
      .context()
      .browser()!
      .newContext({ viewport: { width: 1440, height: 900 } });
    const member = await context.newPage();
    await loginAndWaitForHome(member, 'member');
    await member.getByTestId('notification-bell').click();
    const panel = member.getByTestId('notification-panel');
    await expect(panel).toContainText('十月系統維護通知');
    await shoot(member, 'announcement-bell');
    await panel.getByText('十月系統維護通知').first().click();
    await expect(member.getByTestId('announcement-message-page')).toBeVisible();
    await shoot(member, 'announcement-message');
    await context.close();
  });

  await scene('webhook-list', async () => {
    await open(page, '/webhook', 'webhook-list-page');
    await shoot(page, 'webhook-list');
  });
  await scene('webhook-detail', async () => {
    // 示範資料刪過一位使用者：user.deleted 投遞到不存在的網址，留下失敗與重試的紀錄
    const dialog = await open(page, `/webhook/${demo.webhookId}`, 'webhook-detail-dialog');
    await expect(dialog.getByTestId('webhook-delivery-view').first()).toBeVisible();
    await shoot(page, 'webhook-detail');
    const view = dialog.getByTestId('webhook-delivery-view').first();
    if (await view.isVisible()) {
      await view.click();
      await expect(page.getByTestId('webhook-delivery-detail')).toBeVisible();
      await shoot(page, 'webhook-delivery');
    }
  });
  await scene('webhook-create', async () => {
    const dialog = await open(page, '/webhook/create', 'webhook-create-dialog');
    await dialog.getByTestId('webhook-name-input').fill('ERP 訂單同步');
    await shoot(page, 'webhook-create');
  });
});

test('個人帳號與深色主題', async ({ page }) => {
  await loginAndWaitForHome(page, 'superAdmin');

  await scene('profile', async () => {
    await open(page, '/profile', 'profile-page');
    await shoot(page, 'profile');
  });
  await scene('preference', async () => {
    await open(page, '/preference', 'preference-page');
    await shoot(page, 'preference');
  });
  await scene('dark', async () => {
    // 主題偏好預設「跟隨系統」：模擬系統深色即可，不必改使用者的偏好
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page, '/user', 'user-list-page');
    await shoot(page, 'dark-user-list');
    await open(page, '/permission?view=tree&key=file:delete', 'permission-list-page');
    await zoomInto(page, getByTestIdAndValue(page, 'permission-node', 'file:delete'));
    await shoot(page, 'dark-permission-tree');
    await open(page, `/role/${demo.roleId}/revision`, 'role-revision-dialog');
    await getByTestIdAndValue(page, 'role-revision-item', '1').click();
    await shoot(page, 'dark-role-revision');
    await page.emulateMedia({ colorScheme: 'light' });
  });
});

test('apps/platform', async ({ page }) => {
  await loginPlatform(page);
  await scene('platform-home', () => shoot(page, 'platform-home'));
  await scene('platform-tenant-list', async () => {
    await open(page, `${PLATFORM_URL}/tenant`, 'tenant-page');
    await shoot(page, 'platform-tenant-list');
  });
  await scene('platform-tenant-detail', async () => {
    await page.locator('[data-testid="tenant-link"]').first().click();
    await expect(page.getByTestId('tenant-detail-page')).toBeVisible();
    await shoot(page, 'platform-tenant-overview');
    const url = page.url().split('?')[0];
    await page.goto(`${url}?tab=features`);
    await expect(page.locator('[data-testid="tenant-feature"]').first()).toBeVisible();
    await shoot(page, 'platform-tenant-features');
  });
  await scene('platform-tenant-create', async () => {
    await open(page, `${PLATFORM_URL}/tenant`, 'tenant-page');
    await page.getByTestId('tenant-create-button').click();
    const dialog = page.getByTestId('tenant-create-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('tenant-name-input').fill('Acme 股份有限公司');
    await dialog.getByTestId('tenant-code-input').fill('acme');
    await dialog.getByTestId('tenant-admin-email-input').fill('it@acme.example.com');
    await shoot(page, 'platform-tenant-create');
  });
  await scene('platform-admin', async () => {
    await open(page, `${PLATFORM_URL}/admin`, 'platform-admin-page');
    await shoot(page, 'platform-admin');
  });
  await scene('platform-feature-flag', async () => {
    await open(page, `${PLATFORM_URL}/feature-flag`, 'feature-flag-page');
    await shoot(page, 'platform-feature-flag');
  });
  await scene('platform-audit-log', async () => {
    await open(page, `${PLATFORM_URL}/audit-log`, 'audit-log-page');
    await shoot(page, 'platform-audit-log');
  });
  await scene('platform-job', async () => {
    await open(page, `${PLATFORM_URL}/job`, 'job-page');
    await shoot(page, 'platform-job');
  });
});
