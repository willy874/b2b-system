import { expect, test } from '@playwright/test';

import { apiLogin, apiRequest } from '../helpers/api';
import { expectIdpLogin } from '../helpers/auth';
import { linkIn, waitForMail } from '../helpers/mailpit';
import { snapshot } from '../helpers/snapshot';

const NEW_PASSWORD = 'MailFlow!Password2026';

test.describe('郵件（docs/architecture/backend/11-mail.md）', () => {
  test('管理員建立帳號 → 從信箱點啟用連結設定密碼 → 可以登入', async ({ page }) => {
    const email = `e2e-invitee-${Date.now()}@dev.local`;

    // ① 管理員建立帳號（走 API，重點在後面的收信流程）
    const token = await apiLogin('admin');
    const created = await apiRequest(token, 'post', '/users', {
      email,
      displayName: 'E2E Invitee',
      roleIds: [],
    });
    expect(created.status).toBe(201);

    // ② 從 Mailpit 取出啟用信，打開連結
    const mail = await waitForMail(email);
    expect(mail.subject).toBe('啟用你的 B2B System 帳號');
    await page.goto(linkIn(mail, '/setup'));

    // ③ 設定密碼 → 回到租戶的登入（啟用頁在 apps/platform，帳號屬於租戶：連結帶 ?tenant=）→ 登入
    expect(page.url()).toContain('tenant=default');
    await snapshot(page, 'setup-password');
    await page.getByTestId('setup-password').fill(NEW_PASSWORD);
    await page.getByTestId('setup-confirm').fill(NEW_PASSWORD);
    await page.getByTestId('setup-submit').click();
    await expectIdpLogin(page);

    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-password').fill(NEW_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('home-page')).toBeVisible();
    await expect(page).toHaveURL(/localhost:5173\//);
    await snapshot(page, 'invitee-home');
  });

  test('用過的啟用連結再打開會顯示失效', async ({ page }) => {
    const email = `e2e-invitee-reuse-${Date.now()}@dev.local`;
    const token = await apiLogin('admin');
    await apiRequest(token, 'post', '/users', { email, displayName: 'E2E Reuse', roleIds: [] });

    const link = linkIn(await waitForMail(email), '/setup');
    await page.goto(link);
    await page.getByTestId('setup-password').fill(NEW_PASSWORD);
    await page.getByTestId('setup-confirm').fill(NEW_PASSWORD);
    await page.getByTestId('setup-submit').click();
    await expectIdpLogin(page);

    await page.goto(link);
    await expect(page.getByTestId('setup-invalid')).toBeVisible();
    await snapshot(page, 'setup-link-invalid');
  });
});
