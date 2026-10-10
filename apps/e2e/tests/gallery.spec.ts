import { expect, request, test } from '@playwright/test';
import type { Page, Request } from '@playwright/test';

import { apiLogin, apiRequest } from '../helpers/api';
import { PLATFORM_URL, loginAndWaitForHome, loginPlatform } from '../helpers/auth';
import { openMenuGroup } from '../helpers/menu';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

/**
 * 圖片庫（docs/architecture/backend/26-gallery.md、docs/architecture/frontend/24-gallery.md）：
 * 上傳 → `gallery.process` → 出現在時間軸 → 檢視器切換；放大超過 `large` 才載入原檔（轉過方向的不載）；
 * 檔案管理器的「加入圖片庫」（略過不是圖片的）；member／auditor 只有 `gallery:read`；平台關掉 feature 後入口消失。
 *
 * 種子資料沒有圖片：每個案例自己上傳，以唯一的標題前綴當關鍵字篩選，不受其他案例的圖影響。
 * 最後一個案例會關掉整個租戶的 `gallery`，所以整個檔案依序執行（mode: 'default'），其他 spec 不碰圖片庫。
 */
test.describe.configure({ mode: 'default' });

const unique = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

interface GalleryItemSummary {
  id: string;
  title: string;
}

/**
 * 在瀏覽器裡畫一張 JPEG（e2e 不依賴影像套件）：漸層加上文字，內容不是單色、壓縮後仍有一定大小。
 * 寬度大於 `large`（2560）時，檢視器放大後才有原檔可以載入。
 */
async function drawJpeg(page: Page, width: number, height: number, label: string): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ width: w, height: h, label: text }) => {
      const canvas = new OffscreenCanvas(w, h);
      const context = canvas.getContext('2d')!;
      const gradient = context.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, 'rgb(40, 90, 200)');
      gradient.addColorStop(1, 'rgb(200, 110, 40)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, w, h);
      context.fillStyle = 'white';
      context.font = `${Math.round(h / 8)}px sans-serif`;
      context.fillText(text, w / 10, h / 2);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    { width, height, label },
  );
  return Buffer.from(base64, 'base64');
}

/** 經 API 上傳：登記 → 直傳 → 完成（docs/architecture/backend/26-gallery.md §4）。回傳圖片 id。 */
async function uploadViaApi(token: string, fileName: string, data: Buffer): Promise<string> {
  const registered = await apiRequest(token, 'post', '/gallery/items', {
    fileName,
    contentType: 'image/jpeg',
    size: data.length,
  });
  expect(registered.status).toBe(201);
  const { item, upload } = (
    registered.body as {
      data: { item: { id: string }; upload: { url: string; headers: Record<string, string> } };
    }
  ).data;
  const storage = await request.newContext();
  expect((await storage.put(upload.url, { headers: upload.headers, data })).status()).toBe(200);
  await storage.dispose();
  expect((await apiRequest(token, 'post', `/gallery/items/${item.id}/complete`, {})).status).toBe(
    200,
  );
  return item.id;
}

/** 處理完成（ready）之後才出現在列表：以關鍵字等到張數。 */
async function waitForReady(
  token: string,
  keyword: string,
  count: number,
): Promise<GalleryItemSummary[]> {
  let items: GalleryItemSummary[] = [];
  await expect
    .poll(
      async () => {
        const response = await apiRequest(
          token,
          'get',
          `/gallery/items?keyword=${encodeURIComponent(keyword)}`,
        );
        items = (response.body as { data: { items: GalleryItemSummary[] } }).data.items;
        return items.length;
      },
      { timeout: 30_000 },
    )
    .toBe(count);
  return items;
}

async function deleteItems(token: string, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    // oxlint-disable-next-line no-await-in-loop -- 收尾，張數很少
    await apiRequest(token, 'delete', `/gallery/items/${id}`);
  }
}

/** 一直按「放大」直到按鈕停用（最大倍率）。 */
async function zoomToMax(page: Page): Promise<void> {
  const zoomIn = getByTestIdAndValue(
    page.getByTestId('gallery-viewer'),
    'image-viewer-control',
    'zoomIn',
  );
  for (let step = 0; step < 12; step += 1) {
    // oxlint-disable-next-line no-await-in-loop -- 每一步都要等縮放套用
    if (!(await zoomIn.isEnabled())) break;
    // oxlint-disable-next-line no-await-in-loop -- 同上
    await zoomIn.click();
  }
  await expect(zoomIn).toBeDisabled();
}

test.describe('圖片庫（docs/architecture/backend/26-gallery.md）', () => {
  test(
    '上傳 → 處理完出現在時間軸 → 打開檢視器以 ← / → 切換',
    { tag: '@cross-browser' },
    async ({ page }) => {
      const prefix = unique('e2e-gallery-upload');
      await loginAndWaitForHome(page, 'admin');
      await page.goto(`/gallery?keyword=${prefix}`);
      await expect(page.getByTestId('gallery-page')).toBeVisible();
      await expect(page.getByTestId('gallery-empty')).toBeVisible();

      const files = await Promise.all(
        ['a', 'b', 'c'].map(async (suffix) => ({
          name: `${prefix}-${suffix}.jpg`,
          mimeType: 'image/jpeg',
          buffer: await drawJpeg(page, 640, 480, suffix),
        })),
      );
      await page.getByTestId('gallery-upload-input').setInputFiles(files);

      // 處理完成之前不在列表裡；推播 create 後重抓，三張都出現在今天的區段（依日分組）。
      // 日期捲軸（gallery-timeline）要兩個月以上才顯示，這裡只有一個月
      const items = page.getByTestId('gallery-item');
      await expect(items).toHaveCount(3, { timeout: 30_000 });
      // 瀏覽器時區的今天（分組以瀏覽器的時區算）
      const today = await page.evaluate(() => new Date().toLocaleDateString('sv-SE'));
      await expect(page.getByTestId('gallery-section-select')).toHaveCount(1);
      await expect(page.getByTestId('gallery-section-select')).toHaveAttribute('data-value', today);
      await snapshot(page, 'uploaded');

      const ids = await items.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-value')!),
      );
      await items.first().click();
      const viewer = page.getByTestId('gallery-viewer');
      await expect(viewer).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`[?&]item=${ids[0]}`));
      await expect(viewer.getByTestId('gallery-viewer-title')).toContainText(prefix);

      await page.keyboard.press('ArrowRight');
      await expect(page).toHaveURL(new RegExp(`[?&]item=${ids[1]}`));
      await page.keyboard.press('ArrowRight');
      await expect(page).toHaveURL(new RegExp(`[?&]item=${ids[2]}`));
      await snapshot(page, 'viewer-third');
      await page.keyboard.press('ArrowLeft');
      await expect(page).toHaveURL(new RegExp(`[?&]item=${ids[1]}`));

      // 關閉：網址的 item 拿掉，回到列表
      await page.keyboard.press('Escape');
      await expect(viewer).toHaveCount(0);
      await expect(page).not.toHaveURL(/[?&]item=/);

      await deleteItems(await apiLogin('admin'), ids);
    },
  );

  test('檢視器放大超過 large 才載入原檔；調整過顯示方向後放到最大也不載原檔', async ({ page }) => {
    const token = await apiLogin('admin');
    const prefix = unique('e2e-gallery-original');
    await loginAndWaitForHome(page, 'admin');
    // 比 large（2560）寬：放大到超過 large 的解析度時才換成原檔
    const id = await uploadViaApi(token, `${prefix}.jpg`, await drawJpeg(page, 3600, 2400, 'big'));
    await waitForReady(token, prefix, 1);

    const requests: string[] = [];
    const record = (entry: Request) => requests.push(entry.url());
    page.on('request', record);
    const originalPath = `/gallery/${id}/original`;

    await page.goto(`/gallery?keyword=${prefix}&item=${id}`);
    const viewer = page.getByTestId('gallery-viewer');
    await expect(viewer.getByTestId('image-viewer-image').first()).toBeVisible();
    // 符合視窗時用變體，不抓原檔
    expect(requests.some((url) => url.includes(originalPath))).toBe(false);

    const originalRequest = page.waitForRequest((entry) => entry.url().includes(originalPath));
    await zoomToMax(page);
    await originalRequest;
    await expect(
      viewer.locator(`[data-testid="image-viewer-image"][src*="${originalPath}"]`),
    ).toHaveAttribute('data-level', '2');
    await snapshot(page, 'original-loaded');

    // 向右轉：原檔沒有轉，詳情不再給原檔的網址（docs/architecture/backend/26-gallery.md §5.3）
    await viewer.getByTestId('gallery-viewer-rotate-right').click();
    await expect
      .poll(async () => {
        const detail = await apiRequest(token, 'get', `/gallery/items/${id}`);
        const data = (detail.body as { data: { displayRotation: number; original: unknown } }).data;
        return [data.displayRotation, data.original];
      })
      .toEqual([90, null]);

    await page.goto(`/gallery?keyword=${prefix}`);
    await expect(page.getByTestId('gallery-item')).toHaveCount(1);
    requests.length = 0;
    await page.goto(`/gallery?keyword=${prefix}&item=${id}`);
    await expect(viewer.getByTestId('image-viewer-image').first()).toBeVisible();
    await zoomToMax(page);
    // 給漸進載入一點時間：要換的話這時已經發出請求
    await page.waitForTimeout(1000);
    expect(requests.filter((url) => url.includes(originalPath))).toEqual([]);
    await expect(
      viewer.locator(`[data-testid="image-viewer-image"][src*="${originalPath}"]`),
    ).toHaveCount(0);
    await snapshot(page, 'rotated-without-original');

    page.off('request', record);
    await deleteItems(token, [id]);
  });

  test('檔案管理器的「加入圖片庫」：圖片加入、不是圖片的略過 → 處理完出現在圖片庫', async ({
    page,
  }) => {
    const token = await apiLogin('admin');
    const prefix = unique('e2e-gallery-from-file');
    const created = await apiRequest(token, 'post', '/file-folders', { name: prefix });
    expect(created.status).toBe(201);
    const folderId = (created.body as { data: { id: string } }).data.id;

    await loginAndWaitForHome(page, 'admin');
    const image = await drawJpeg(page, 800, 600, 'file');
    await page.goto(`/file?folder=${folderId}`);
    await expect(page.getByTestId('file-manager-page')).toBeVisible();
    await page.getByTestId('file-upload-input').setInputFiles([
      { name: `${prefix}.jpg`, mimeType: 'image/jpeg', buffer: image },
      { name: `${prefix}-notes.txt`, mimeType: 'text/plain', buffer: Buffer.from('not an image') },
    ]);
    const fileItems = page.getByTestId('file-item');
    await expect(fileItems).toHaveCount(2);
    for (const item of await fileItems.all()) {
      // oxlint-disable-next-line no-await-in-loop -- 逐一勾選
      await item.getByTestId('file-item-checkbox').click();
    }
    await expect(page.getByTestId('file-selection-count')).toHaveAttribute('data-value', '2');

    await getByTestIdAndValue(page, 'file-selection-action', 'gallery.add').click();
    const dialog = page.getByTestId('gallery-add-from-file-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('gallery-add-from-file-submit').click();
    await expect(dialog.getByTestId('gallery-add-from-file-added')).toHaveAttribute(
      'data-value',
      '1',
    );
    await expect(dialog.getByTestId('gallery-add-from-file-skipped')).toContainText(
      `${prefix}-notes.txt`,
    );
    await snapshot(page, 'added-from-file');

    // 「前往圖片庫」以 route id 連過去；處理完成後出現
    await dialog.getByTestId('gallery-add-from-file-open').click();
    await expect(page.getByTestId('gallery-page')).toBeVisible();
    const [added] = await waitForReady(token, prefix, 1);
    await page.goto(`/gallery?keyword=${prefix}`);
    await expect(getByTestIdAndValue(page, 'gallery-item', added!.id)).toBeVisible();

    await deleteItems(token, [added!.id]);
    await apiRequest(token, 'delete', `/file-folders/${folderId}`);
  });

  for (const role of ['member', 'auditor'] as const) {
    test(`${role} 只有 gallery:read：看得到列表、檢視器、相簿與篩選；沒有任何寫入的入口，直接打 API 回 403`, async ({
      page,
    }) => {
      const adminToken = await apiLogin('admin');
      const prefix = unique(`e2e-gallery-${role}`);
      await loginAndWaitForHome(page, role);
      const id = await uploadViaApi(
        adminToken,
        `${prefix}.jpg`,
        await drawJpeg(page, 640, 480, role),
      );
      await waitForReady(adminToken, prefix, 1);
      const album = await apiRequest(adminToken, 'post', '/gallery/albums', { name: prefix });
      expect(album.status).toBe(201);
      const albumId = (album.body as { data: { id: string } }).data.id;
      expect(
        (
          await apiRequest(adminToken, 'post', `/gallery/albums/${albumId}/items`, {
            itemIds: [id],
          })
        ).status,
      ).toBe(200);

      // 列表與篩選：關鍵字只留這一張；沒有「加入」與「新增相簿」
      await page.goto(`/gallery?keyword=${prefix}`);
      await expect(page.getByTestId('gallery-page')).toBeVisible();
      await expect(page.getByTestId('gallery-item')).toHaveCount(1);
      await expect(getByTestIdAndValue(page, 'gallery-album-card', albumId)).toBeVisible();
      await expect(page.getByTestId('gallery-add-button')).toHaveCount(0);
      await expect(page.getByTestId('gallery-album-create')).toHaveCount(0);

      // 多選只剩「下載」
      await page.getByTestId('gallery-item-select').click();
      await expect(page.getByTestId('gallery-selection-download')).toBeVisible();
      for (const testId of [
        'gallery-selection-add-to-album',
        'gallery-selection-tag',
        'gallery-selection-delete',
      ]) {
        // oxlint-disable-next-line no-await-in-loop -- 逐一斷言
        await expect(page.getByTestId(testId)).toHaveCount(0);
      }
      await snapshot(page, 'read-only-list');
      await page.getByTestId('gallery-selection-clear').click();

      // 檢視器：可以看與下載，不能改標題與說明、旋轉、貼標籤、加入相簿、刪除
      await page.getByTestId('gallery-item').click();
      const viewer = page.getByTestId('gallery-viewer');
      await expect(viewer).toBeVisible();
      await expect(viewer.getByTestId('gallery-viewer-download')).toBeVisible();
      for (const testId of [
        'gallery-viewer-rotate-left',
        'gallery-viewer-rotate-right',
        'gallery-viewer-tag',
        'gallery-viewer-add-to-album',
        'gallery-viewer-delete',
        'gallery-info-save',
      ]) {
        // oxlint-disable-next-line no-await-in-loop -- 逐一斷言
        await expect(viewer.getByTestId(testId)).toHaveCount(0);
      }
      await expect(viewer.getByTestId('gallery-info-title')).toHaveAttribute('readonly', '');
      await expect(viewer.getByTestId('gallery-info-description')).toHaveAttribute('readonly', '');
      await snapshot(page, 'read-only-viewer');
      await page.keyboard.press('Escape');

      // 相簿頁：看得到相簿裡的圖，沒有編輯與刪除
      await page.goto(`/gallery/album/${albumId}`);
      await expect(page.getByTestId('gallery-title')).toContainText(prefix);
      await expect(getByTestIdAndValue(page, 'gallery-item', id)).toBeVisible();
      await expect(page.getByTestId('gallery-album-edit')).toHaveCount(0);
      await expect(page.getByTestId('gallery-album-delete')).toHaveCount(0);

      // 直接打 API：寫入一律 403
      const token = await apiLogin(role);
      const detail = await apiRequest(token, 'get', `/gallery/items/${id}`);
      expect(detail.status).toBe(200);
      const version = (detail.body as { data: { version: number } }).data.version;
      const writes: Array<
        [method: 'post' | 'patch' | 'put' | 'delete', path: string, body?: unknown]
      > = [
        ['post', '/gallery/items', { fileName: 'x.jpg', contentType: 'image/jpeg', size: 100 }],
        ['post', '/gallery/items/from-source', { source: 'file', refIds: [id] }],
        ['patch', `/gallery/items/${id}`, { version, title: 'renamed' }],
        ['patch', `/gallery/items/${id}`, { version, displayRotation: 90 }],
        ['delete', `/gallery/items/${id}`],
        ['post', '/gallery/albums', { name: unique('e2e-forbidden') }],
        ['patch', `/gallery/albums/${albumId}`, { version: 1, name: 'renamed' }],
        ['post', `/gallery/albums/${albumId}/items/remove`, { itemIds: [id] }],
        ['delete', `/gallery/albums/${albumId}`],
        ['put', `/tags/assignments/galleryItem/${id}`, { tagIds: [] }],
      ];
      for (const [method, path, body] of writes) {
        // oxlint-disable-next-line no-await-in-loop -- 逐一斷言，失敗時看得出是哪一個
        const response = await apiRequest(token, method, path, body);
        expect({ method, path, status: response.status }).toEqual({ method, path, status: 403 });
      }

      await apiRequest(adminToken, 'delete', `/gallery/albums/${albumId}`);
      await deleteItems(adminToken, [id]);
    });
  }

  test('沒有 gallery:create 的人在檔案管理器看不到「加入圖片庫」', async ({ page }) => {
    // 登記時 isAvailable 是 gallery:create（docs/architecture/frontend/24-gallery.md §6.1）：不出現，而不是按了才被拒
    const name = `${unique('e2e-gallery-member-file')}.jpg`;
    await loginAndWaitForHome(page, 'member');
    const image = await drawJpeg(page, 640, 480, 'member');
    // member 的個人資料夾（第一次打開檔案管理時由 api 補建）
    await page.goto('/file');
    await expect(page.getByTestId('file-manager-page')).toBeVisible();
    await expect(page).toHaveURL(/[?&]folder=/);
    await page.getByTestId('file-upload-input').setInputFiles({
      name,
      mimeType: 'image/jpeg',
      buffer: image,
    });
    const item = page.getByTestId('file-item').filter({ hasText: name });
    await expect(item).toBeVisible();
    await item.getByTestId('file-item-checkbox').click();
    await expect(page.getByTestId('file-selection-download')).toBeVisible();
    await expect(getByTestIdAndValue(page, 'file-selection-action', 'gallery.add')).toHaveCount(0);

    // LightBox 也沒有
    await item.dblclick();
    await expect(page.getByTestId('file-lightbox')).toBeVisible();
    await expect(getByTestIdAndValue(page, 'file-lightbox-action', 'gallery.add')).toHaveCount(0);
    await snapshot(page, 'member-file-without-gallery-action');
  });

  test('平台關掉租戶的「圖片庫」→ 側欄與檔案管理器的「加入圖片庫」消失、端點 404；重新打開後恢復', async ({
    browser,
  }) => {
    const adminToken = await apiLogin('admin');
    const created = await apiRequest(adminToken, 'post', '/file-folders', {
      name: unique('e2e-gallery-feature'),
    });
    expect(created.status).toBe(201);
    const folderId = (created.body as { data: { id: string } }).data.id;

    const tenantContext = await browser.newContext();
    const tenantPage = await tenantContext.newPage();
    await loginAndWaitForHome(tenantPage, 'admin');
    const image = await drawJpeg(tenantPage, 640, 480, 'feature');
    await tenantPage.goto(`/file?folder=${folderId}`);
    await tenantPage.getByTestId('file-upload-input').setInputFiles({
      name: 'feature.jpg',
      mimeType: 'image/jpeg',
      buffer: image,
    });
    const fileItem = tenantPage.getByTestId('file-item');
    await expect(fileItem).toHaveCount(1);
    await fileItem.getByTestId('file-item-checkbox').click();
    const addAction = getByTestIdAndValue(tenantPage, 'file-selection-action', 'gallery.add');
    await expect(addAction).toBeVisible();

    // 停在圖片庫：feature 關掉時被推播帶回首頁
    await tenantPage.goto('/gallery');
    await expect(tenantPage.getByTestId('gallery-page')).toBeVisible();
    await expect(tenantPage.getByTestId('realtime-status')).toHaveAttribute(
      'data-value',
      'connected',
    );

    const platformContext = await browser.newContext();
    const platform = await platformContext.newPage();
    await loginPlatform(platform);
    await platform.goto(`${PLATFORM_URL}/tenant`);
    await getByTestIdAndValue(platform, 'tenant-link', 'default').click();
    await getByTestIdAndValue(platform, 'tab', 'features').click();
    const toggle = getByTestIdAndValue(platform, 'tenant-feature', 'gallery').getByTestId(
      'tenant-feature-toggle',
    );
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await platform.getByTestId('tenant-feature-dialog').getByTestId('alert-dialog-confirm').click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    try {
      await expect(tenantPage.getByTestId('home-page')).toBeVisible();
      await openMenuGroup(tenantPage, 'menu-group-feature');
      await expect(tenantPage.getByTestId('menu-file')).toBeVisible();
      await expect(tenantPage.getByTestId('menu-gallery')).toHaveCount(0);
      await snapshot(tenantPage, 'backstage-without-gallery');

      const disabled = await apiRequest(adminToken, 'get', '/gallery/items');
      expect(disabled.status).toBe(404);
      expect(disabled.body).toMatchObject({ error: { code: 'FEATURE_DISABLED' } });

      await tenantPage.goto('/gallery');
      await expect(tenantPage.getByTestId('not-found-page')).toBeVisible();

      // 檔案管理器照常，只是沒有「加入圖片庫」
      await tenantPage.goto(`/file?folder=${folderId}`);
      await fileItem.getByTestId('file-item-checkbox').click();
      await expect(tenantPage.getByTestId('file-selection-download')).toBeVisible();
      await expect(addAction).toHaveCount(0);
    } finally {
      // 重新打開（不需確認）：其他案例與重跑的起點一致
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
    }

    await expect
      .poll(async () => (await apiRequest(adminToken, 'get', '/gallery/items')).status)
      .toBe(200);
    await tenantPage.goto(`/file?folder=${folderId}`);
    await fileItem.getByTestId('file-item-checkbox').click();
    await expect(addAction).toBeVisible();
    await tenantPage.goto('/gallery');
    await expect(tenantPage.getByTestId('gallery-page')).toBeVisible();

    await platformContext.close();
    await tenantContext.close();
    await apiRequest(adminToken, 'delete', `/file-folders/${folderId}`);
  });
});
