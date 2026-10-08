import { expect, test } from '@playwright/test';

import { loginAndWaitForHome } from '../helpers/auth';
import { openMenuGroup } from '../helpers/menu';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

/**
 * 權限目錄（docs/architecture/iam/02-permission-catalog.md）：篩選寫進網址、從清單跳到技能樹看包含與依賴；
 * 「我持有的」篩選依登入者的權限（auditor 是唯讀角色）。
 */
test.describe('權限目錄（docs/architecture/iam/02-permission-catalog.md）', () => {
  test('auditor 以關鍵字篩選 → 從清單跳到技能樹，看 user:update 包含與依賴的權限', async ({
    page,
  }) => {
    await loginAndWaitForHome(page, 'auditor');
    await openMenuGroup(page, 'menu-group-people');
    await page.getByTestId('menu-permission').click();
    await expect(page.getByTestId('permission-list-page')).toBeVisible();

    await page.getByTestId('permission-filter-keyword').fill('user:update');
    await expect(page).toHaveURL(/keyword=user/);
    await getByTestIdAndValue(page, 'permission-show-in-tree', 'user:update').click();
    await expect(page).toHaveURL(/view=tree/);
    const detail = page.getByTestId('permission-detail');
    await expect(detail).toBeVisible();
    // user:update 包含 user:read（docs/architecture/iam/02-permission-catalog.md 的包含關係）
    await expect(
      getByTestIdAndValue(
        detail.getByTestId('permission-detail-includes'),
        'permission-detail-link',
        'user:read',
      ),
    ).toBeVisible();
    await snapshot(page, 'permission-tree-detail');

    // 「我持有的」：auditor 持有 user:read，不持有 user:update
    await page.goto('/permission?held=held');
    await page.getByTestId('permission-filter-keyword').fill('user:');
    await expect(getByTestIdAndValue(page, 'permission-show-in-tree', 'user:read')).toBeVisible();
    await expect(getByTestIdAndValue(page, 'permission-show-in-tree', 'user:update')).toHaveCount(
      0,
    );
    await page.goto('/permission?held=notHeld');
    await page.getByTestId('permission-filter-keyword').fill('user:');
    await expect(getByTestIdAndValue(page, 'permission-show-in-tree', 'user:update')).toBeVisible();
    await expect(getByTestIdAndValue(page, 'permission-show-in-tree', 'user:read')).toHaveCount(0);
    await snapshot(page, 'permission-not-held');
  });

  test('member 沒有權限目錄，直接進網址是 403 頁', async ({ page }) => {
    await loginAndWaitForHome(page, 'member');
    await page.goto('/permission');
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
  });
});
