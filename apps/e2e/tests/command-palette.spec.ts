import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { loginAndWaitForHome, loginPlatform } from '../helpers/auth';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

/**
 * ⌘K 或 Ctrl+K：與 app 判斷平台的方式相同（web-core 的 `isMacPlatform`）。
 * 不用 Playwright 的 `ControlOrMeta`：它看的是跑測試的主機，headless 瀏覽器回報的平台不一定一樣。
 */
async function pressPaletteHotkey(page: Page): Promise<void> {
  const isMac = await page.evaluate(() => {
    const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
    return /mac|iphone|ipad|ipod/i.test(data?.platform ?? navigator.platform);
  });
  await page.keyboard.press(isMac ? 'Meta+k' : 'Control+k');
}

/** 命令面板（docs/architecture/frontend/18-command-palette.md）。 */
test.describe('命令面板', () => {
  test('⌘K／Ctrl+K 打開；搜尋使用者並跳到詳情頁', async ({ page }) => {
    await loginAndWaitForHome(page, 'admin');
    await pressPaletteHotkey(page);
    const input = page.getByTestId('command-palette-input');
    await expect(input).toBeFocused();
    await expect(getByTestIdAndValue(page, 'command-palette-item', 'pages:USER')).toBeVisible();

    await input.fill('E2E Auditor');
    const result = page
      .getByTestId('command-palette-section')
      .and(page.locator('[data-value="user"]'))
      .getByTestId('command-palette-item');
    await expect(result).toHaveCount(1);
    await expect(result).toContainText('e2e-auditor@dev.local');
    await snapshot(page, 'command-palette-search');

    await result.click();
    await expect(page).toHaveURL(/\/user\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('command-palette')).toHaveCount(0);
  });

  test('頂列的搜尋按鈕；鍵盤選頁面；最近造訪記下剛去過的頁面', async ({ page }) => {
    await loginAndWaitForHome(page, 'admin');
    await page.getByTestId('command-palette-trigger').click();
    const input = page.getByTestId('command-palette-input');
    // 不輸入文字（頁面名稱隨語系變）：以方向鍵移到「角色」
    const role = getByTestIdAndValue(page, 'command-palette-item', 'pages:ROLE');
    await expect(role).toBeVisible();
    for (let step = 0; step < 30; step += 1) {
      if ((await role.getAttribute('aria-selected')) === 'true') break;
      await input.press('ArrowDown');
    }
    await expect(role).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
    await expect(page).toHaveURL(/\/role$/);

    await pressPaletteHotkey(page);
    await expect(getByTestIdAndValue(page, 'command-palette-item', 'recent:ROLE')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('command-palette')).toHaveCount(0);
  });

  test('member 只看得到自己進得去的頁面，沒有管理的動作與資料搜尋', async ({ page }) => {
    await loginAndWaitForHome(page, 'member');
    await pressPaletteHotkey(page);
    await expect(getByTestIdAndValue(page, 'command-palette-item', 'pages:HOME')).toBeVisible();
    await expect(getByTestIdAndValue(page, 'command-palette-item', 'pages:USER')).toHaveCount(0);
    await expect(
      getByTestIdAndValue(page, 'command-palette-item', 'commands:user.create'),
    ).toHaveCount(0);

    await page.getByTestId('command-palette-input').fill('E2E');
    await expect(page.getByTestId('command-palette-empty')).toBeVisible();
  });

  test('apps/platform 也有命令面板（頁面）', async ({ page }) => {
    await loginPlatform(page);
    await pressPaletteHotkey(page);
    await expect(page.getByTestId('command-palette-input')).toBeFocused();
    await expect(getByTestIdAndValue(page, 'command-palette-item', 'pages:TENANT')).toBeVisible();
  });
});
