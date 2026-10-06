import { expect, test } from '@playwright/test';

import { apiLogin, apiRequest } from '../helpers/api';
import { loginAndWaitForHome } from '../helpers/auth';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';
import { expectedSignature, startWebhookReceiver } from '../helpers/webhook-receiver';
import type { WebhookReceiver } from '../helpers/webhook-receiver';

/**
 * Webhook（docs/architecture/backend/17-webhook.md）：建立訂閱 → 測試投遞與真實事件經背景工作送到接收端，
 * 接收端以建立時只顯示一次的密鑰驗簽。接收端在測試程序內起在 127.0.0.1。
 * 租戶預設只允許 1 個不重複的目標網址（`webhook.maxUrls`）：整個 spec 共用一個接收端、依序執行，每個案例刪掉自己的訂閱。
 */

const unique = (prefix: string) => `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const SECRET_PATTERN = /whsec_[A-Za-z0-9_-]+/;

/** 這個案例建立的訂閱：`afterEach` 一律刪掉，失敗的案例也不會留下佔住網址上限的訂閱。 */
const createdIds: string[] = [];

async function createWebhook(token: string, url: string): Promise<string> {
  const created = await apiRequest(token, 'post', '/webhooks', {
    name: unique('E2E Webhook'),
    urls: [url],
    events: ['user.created'],
  });
  expect(created.status).toBe(201);
  const id = (created.body as { data: { webhook: { id: string } } }).data.webhook.id;
  createdIds.push(id);
  return id;
}

test.describe('Webhook（docs/architecture/backend/17-webhook.md）', () => {
  test.describe.configure({ mode: 'serial' });

  let receiver: WebhookReceiver;
  test.beforeAll(async () => {
    receiver = await startWebhookReceiver();
  });
  test.afterAll(async () => {
    await receiver.close();
  });
  test.afterEach(async () => {
    receiver.respondWith(204);
    const token = await apiLogin('admin');
    await Promise.all(
      createdIds.splice(0).map((id) => apiRequest(token, 'delete', `/webhooks/${id}`)),
    );
  });

  test('建立訂閱 → 密鑰只顯示一次 → 測試投遞與真實事件都送到接收端，簽章驗得過', async ({
    page,
  }) => {
    const name = unique('E2E Webhook');

    await loginAndWaitForHome(page, 'admin');
    await page.goto('/webhook');
    await page.getByTestId('webhook-create-button').click();
    await page.getByTestId('webhook-name-input').fill(name);
    await getByTestIdAndValue(page, 'webhook-url-input', '0').fill(receiver.url);
    await page.getByTestId('webhook-events-select').click();
    await getByTestIdAndValue(page, 'select-item', 'user.created').click();
    await page.keyboard.press('Escape');
    await page.getByTestId('webhook-create-submit').click();

    // 密鑰只在建立後出現這一次
    const secretText = await page.getByTestId('webhook-secret-value').textContent();
    const secret = SECRET_PATTERN.exec(secretText ?? '')![0];
    await snapshot(page, 'secret-shown-once');
    await page.getByTestId('webhook-create-done').click();
    const detail = page.getByTestId('webhook-detail-dialog');
    await expect(detail.getByTestId('webhook-settings-section')).toBeVisible();
    createdIds.push(/\/webhook\/([0-9a-f-]+)/.exec(page.url())![1]!);
    await expect(detail.getByTestId('webhook-secret-notice')).toHaveCount(0);

    // ① 測試投遞（同步）：接收端收到 webhook.ping，投遞紀錄記成功
    await detail.getByTestId('webhook-test-button').click();
    const ping = await receiver.waitFor('webhook.ping');
    expect(ping.headers['x-webhook-signature']).toBe(expectedSignature(secret, ping));
    expect(ping.headers['x-webhook-event']).toBe('webhook.ping');
    await expect(
      getByTestIdAndValue(detail, 'webhook-delivery-result', 'succeeded').first(),
    ).toBeVisible();
    await snapshot(page, 'test-delivery-succeeded');

    // ② 真實事件：建立使用者 → 背景工作投遞 user.created
    const token = await apiLogin('admin');
    const email = `e2e-webhook-${Date.now()}@dev.local`;
    const user = await apiRequest(token, 'post', '/users', { email, displayName: 'E2E Webhook' });
    expect(user.status).toBe(201);
    const userId = (user.body as { data: { id: string } }).data.id;
    const event = await receiver.waitFor(
      'user.created',
      (hook) => hook.envelope.data.userId === userId,
    );
    expect(event.headers['x-webhook-signature']).toBe(expectedSignature(secret, event));
    expect(event.headers['x-webhook-id']).toBe(event.envelope.id);
  });

  test('接收端回 5xx 時，測試投遞記成失敗並可重送', async ({ page }) => {
    receiver.respondWith(500);
    const token = await apiLogin('admin');
    const webhookId = await createWebhook(token, receiver.url);

    await loginAndWaitForHome(page, 'admin');
    await page.goto(`/webhook/${webhookId}`);
    const detail = page.getByTestId('webhook-detail-dialog');
    await detail.getByTestId('webhook-test-button').click();
    const failed = getByTestIdAndValue(detail, 'webhook-delivery-result', 'failed');
    await expect(failed).toHaveCount(1);
    await expect(detail.getByTestId('webhook-delivery-redeliver')).toBeVisible();
    await snapshot(page, 'test-delivery-failed');

    // 重送同一筆事件：多一筆失敗的紀錄
    await detail.getByTestId('webhook-delivery-redeliver').first().click();
    await expect(failed).toHaveCount(2);
  });

  test('auditor 看得到訂閱與投遞紀錄，但沒有建立與測試投遞的操作', async ({ page }) => {
    const token = await apiLogin('admin');
    const webhookId = await createWebhook(token, receiver.url);

    await loginAndWaitForHome(page, 'auditor');
    await page.goto('/webhook');
    await expect(page.getByTestId('webhook-list-page')).toBeVisible();
    await expect(page.getByTestId('webhook-create-button')).toHaveCount(0);
    await expect(page.getByTestId('webhook-delete-button')).toHaveCount(0);

    await page.goto(`/webhook/${webhookId}`);
    const detail = page.getByTestId('webhook-detail-dialog');
    await expect(detail.getByTestId('webhook-delivery-section')).toBeVisible();
    await expect(detail.getByTestId('webhook-test-button')).toHaveCount(0);
    await expect(detail.getByTestId('webhook-edit-button')).toHaveCount(0);
    await expect(detail.getByTestId('webhook-rotate-button')).toHaveCount(0);
    await snapshot(page, 'auditor-read-only');
  });

  test('member 沒有 Webhook 選單，直接進網址是 403 頁', async ({ page }) => {
    await loginAndWaitForHome(page, 'member');
    await expect(page.getByTestId('menu-webhook')).toHaveCount(0);
    await page.goto('/webhook');
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
  });
});
