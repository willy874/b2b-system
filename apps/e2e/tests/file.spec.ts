import { expect, request, test } from '@playwright/test';

import { ACCOUNTS } from '../fixtures/accounts';
import { apiLogin, apiRequest } from '../helpers/api';
import { loginAndWaitForHome } from '../helpers/auth';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

/**
 * 檔案管理與資料夾授權（docs/architecture/backend/09-file.md、docs/architecture/iam/06-resource-grants.md）：
 * 上傳經 presigned URL 直傳物件儲存、預覽與下載；別人的資料夾預設鎖住，申請存取 → 擁有者核准 → 看得到；撤銷後又鎖住。
 * 分享用的資料夾由 admin 建在根目錄（只有全域 `file:read` 的人看得到，member 預設鎖住），被分享的人用專用帳號 `shareTarget`。
 * 個人資料夾：global-setup 在 api 跑著時重灌資料庫，種子帳號一開始沒有；第一次打開檔案管理時由 api 補建。
 */

const unique = (prefix: string) => `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function createFolder(token: string, name: string): Promise<string> {
  const created = await apiRequest(token, 'post', '/file-folders', { name });
  expect(created.status).toBe(201);
  return (created.body as { data: { id: string } }).data.id;
}

/** 登記 → 直傳到 presigned URL → 完成（docs/architecture/backend/09-file.md）。 */
async function uploadTextFile(token: string, folderId: string, name: string): Promise<string> {
  const content = 'E2E 分享測試檔';
  const registered = await apiRequest(token, 'post', '/files', {
    name,
    contentType: 'text/plain',
    size: Buffer.byteLength(content),
    folderId,
  });
  expect(registered.status).toBe(201);
  const { file, upload } = (
    registered.body as {
      data: { file: { id: string }; upload: { url: string; headers: Record<string, string> } };
    }
  ).data;
  const storage = await request.newContext();
  expect((await storage.put(upload.url, { headers: upload.headers, data: content })).status()).toBe(
    200,
  );
  await storage.dispose();
  expect((await apiRequest(token, 'post', `/files/${file.id}/complete`, {})).status).toBe(200);
  return file.id;
}

async function userIdOf(token: string, email: string): Promise<string> {
  const response = await apiRequest(token, 'get', `/users?keyword=${encodeURIComponent(email)}`);
  return (response.body as { data: { items: Array<{ id: string }> } }).data.items[0]!.id;
}

test.describe('檔案管理（docs/architecture/backend/09-file.md）', () => {
  test('member 打開檔案管理就落在自己的個人資料夾，可以上傳', async ({ page }) => {
    const name = `${unique('e2e-personal')}.txt`;
    await loginAndWaitForHome(page, 'member');
    await page.goto('/file');
    await expect(page.getByTestId('file-manager-page')).toBeVisible();

    const token = await apiLogin('member');
    const folders = await apiRequest(token, 'get', '/file-folders');
    const personalFolderId = (folders.body as { data: { personalFolderId: string | null } }).data
      .personalFolderId;
    expect(personalFolderId).toBeTruthy();
    await expect(page).toHaveURL(new RegExp(`[?&]folder=${personalFolderId}`));

    await page.getByTestId('file-upload-input').setInputFiles({
      name,
      mimeType: 'text/plain',
      buffer: Buffer.from('personal'),
    });
    await expect(page.getByTestId('file-item').filter({ hasText: name })).toBeVisible();
    await snapshot(page, 'personal-folder-upload');
  });

  test('直傳網址綁定大小、只能寫一次：大小不同回 403，完成後用同一個網址再 PUT 回 412', async () => {
    const content = 'once';
    const token = await apiLogin('admin');
    const folderId = await createFolder(token, unique('E2E 直傳'));
    const registered = await apiRequest(token, 'post', '/files', {
      name: `${unique('e2e-once')}.txt`,
      contentType: 'text/plain',
      size: Buffer.byteLength(content),
      folderId,
    });
    expect(registered.status).toBe(201);
    const { file, upload } = (
      registered.body as {
        data: { file: { id: string }; upload: { url: string; headers: Record<string, string> } };
      }
    ).data;
    const storage = await request.newContext();
    const put = async (data: string) =>
      (await storage.put(upload.url, { headers: upload.headers, data })).status();

    expect(await put(`${content}!`)).toBe(403);
    expect(await put(content)).toBe(200);
    expect((await apiRequest(token, 'post', `/files/${file.id}/complete`, {})).status).toBe(200);
    expect(await put(content)).toBe(412);
    await storage.dispose();

    await apiRequest(token, 'delete', `/file-folders/${folderId}`);
  });

  test('上傳文字檔 → 出現在列表 → 預覽看到內容、可以下載', async ({ page }) => {
    const name = `${unique('e2e-upload')}.txt`;
    const content = 'Hello from the E2E upload test.';
    const token = await apiLogin('admin');
    const folderId = await createFolder(token, unique('E2E 上傳'));

    await loginAndWaitForHome(page, 'admin');
    await page.goto(`/file?folder=${folderId}`);
    await expect(page.getByTestId('file-manager-page')).toBeVisible();
    await expect(page.getByTestId('file-empty')).toBeVisible();
    await page.getByTestId('file-upload-input').setInputFiles({
      name,
      mimeType: 'text/plain',
      buffer: Buffer.from(content),
    });
    const item = page.getByTestId('file-item').filter({ hasText: name });
    await expect(item).toBeVisible();
    await snapshot(page, 'uploaded');

    await item.dblclick();
    const lightbox = page.getByTestId('file-lightbox');
    await expect(lightbox.getByTestId('file-preview-text')).toContainText(content);
    const href = await lightbox.getByTestId('file-lightbox-download').getAttribute('href');
    expect(href).toBeTruthy();
    await snapshot(page, 'preview');

    // 下載網址是 presigned URL：直接取得就是原本的內容
    const storage = await request.newContext();
    const downloaded = await storage.get(new URL(href!, page.url()).toString());
    expect(downloaded.status()).toBe(200);
    expect(await downloaded.text()).toBe(content);
    await storage.dispose();

    await apiRequest(token, 'delete', `/file-folders/${folderId}`);
  });

  test('沒有授權的資料夾鎖住 → 申請存取 → 管理者在分享對話框核准 → 看得到檔案；撤銷後又鎖住', async ({
    page,
    browser,
  }) => {
    const ownerToken = await apiLogin('admin');
    const fileName = `${unique('e2e-shared')}.txt`;
    const folderId = await createFolder(ownerToken, unique('E2E 分享資料夾'));
    await uploadTextFile(ownerToken, folderId, fileName);
    const targetToken = await apiLogin('shareTarget');
    const targetId = await userIdOf(ownerToken, ACCOUNTS.shareTarget);

    // ① 被分享的人：資料夾鎖住 → 申請檢視
    await loginAndWaitForHome(page, 'shareTarget');
    await page.goto(`/file?folder=${folderId}`);
    await expect(getByTestIdAndValue(page, 'file-locked-notice', 'locked')).toBeVisible();
    await expect(page.getByTestId('file-item')).toHaveCount(0);
    await page.getByTestId('file-access-request-button').click();
    const requestDialog = page.getByTestId('file-access-request-dialog');
    await requestDialog.getByTestId('file-access-request-reason').fill('E2E 申請');
    await requestDialog.getByTestId('file-access-request-submit').click();
    await expect(getByTestIdAndValue(page, 'file-locked-notice', 'pending')).toBeVisible();
    await snapshot(page, 'access-requested');

    // ② 能分享的人（admin 有 file:share）：在資料夾的分享對話框核准
    const ownerContext = await browser.newContext();
    const owner = await ownerContext.newPage();
    await loginAndWaitForHome(owner, 'admin');
    await owner.goto(`/file?folder=${folderId}`);
    await owner.getByTestId('file-share-button').click();
    const shareDialog = owner.getByTestId('file-share-dialog');
    await shareDialog.getByTestId('file-access-request-approve').click();
    await expect(getByTestIdAndValue(shareDialog, 'file-share-grant', targetId)).toBeVisible();
    await snapshot(owner, 'request-approved');

    // ③ 被分享的人看得到檔案
    await page.reload();
    await expect(page.getByTestId('file-item').filter({ hasText: fileName })).toBeVisible();
    await snapshot(page, 'access-granted');

    // ④ 移除授權 → 又鎖住
    await getByTestIdAndValue(shareDialog, 'file-share-grant', targetId)
      .getByTestId('file-share-grant-remove')
      .click();
    await expect(getByTestIdAndValue(shareDialog, 'file-share-grant', targetId)).toHaveCount(0);
    const files = await apiRequest(targetToken, 'get', `/files?folderId=${folderId}`);
    expect(files.status).toBe(403);
    await page.reload();
    await expect(getByTestIdAndValue(page, 'file-locked-notice', 'locked')).toBeVisible();

    await ownerContext.close();
    await apiRequest(ownerToken, 'delete', `/file-folders/${folderId}`);
  });
});
