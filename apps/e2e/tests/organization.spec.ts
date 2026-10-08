import { expect, test } from '@playwright/test';

import { apiLogin, apiRequest } from '../helpers/api';
import { loginAndWaitForHome } from '../helpers/auth';
import { openMenuGroup } from '../helpers/menu';
import { getByTestIdAndValue } from '../helpers/selectors';
import { snapshot } from '../helpers/snapshot';

/**
 * 組織管理（docs/architecture/backend/23-organization.md）：部門樹、成員與主管、使用者詳情的「所屬部門」、
 * 使用者列表的部門篩選、組織圖的編輯模式、回收桶還原。部門與成員都在測試內建立，名稱帶時間戳，
 * 不碰其他 spec 的資料；成員是測試內新建的使用者（不能改到自己，D6）。
 */

interface Created {
  data: { id: string };
}

const unique = (prefix: string) => `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function createUnit(token: string, name: string, parentId?: string): Promise<string> {
  const created = await apiRequest(token, 'post', '/org-units', { name, parentId });
  expect(created.status).toBe(201);
  return (created.body as Created).data.id;
}

async function createUser(token: string, displayName: string): Promise<string> {
  const created = await apiRequest(token, 'post', '/users', {
    email: `e2e-org-${Date.now()}-${Math.floor(Math.random() * 1e6)}@dev.local`,
    displayName,
  });
  expect(created.status).toBe(201);
  return (created.body as Created).data.id;
}

/** 由下往上刪：有下層的部門不能刪（ORG_UNIT_HAS_CHILDREN）。 */
async function deleteUnits(token: string, idsDeepestFirst: string[]): Promise<void> {
  // oxlint-disable-next-line no-await-in-loop -- 依序：上層要等下層刪掉
  for (const id of idsDeepestFirst) await apiRequest(token, 'delete', `/org-units/${id}`);
}

test.describe('組織管理（docs/architecture/backend/23-organization.md）', () => {
  test('建立部門與下層部門 → 成員設為主管與主要部門 → 使用者詳情與列表的部門篩選看得到', async ({
    page,
  }) => {
    const token = await apiLogin('admin');
    const userName = unique('E2E 部門成員');
    const userId = await createUser(token, userName);
    const parentName = unique('E2E 事業處');
    const childName = unique('E2E 業務組');

    await loginAndWaitForHome(page, 'admin');
    await openMenuGroup(page, 'menu-group-people');
    await page.getByTestId('menu-organization').click();
    await expect(page.getByTestId('organization-page')).toBeVisible();

    // ① 最上層部門：建立後自動選取（網址帶 unitId）
    await page.getByTestId('org-unit-create-button').click();
    const createDialog = page.getByTestId('org-unit-create-dialog');
    await createDialog.getByTestId('org-unit-create-name').fill(parentName);
    await createDialog.getByTestId('org-unit-create-submit').click();
    await expect(page.getByTestId('org-unit-name')).toHaveText(parentName);
    const parentId = new URL(page.url()).searchParams.get('unitId')!;
    expect(parentId).toBeTruthy();

    // ② 下層部門：從詳情的「新增下層部門」
    await page.getByTestId('org-unit-create-child-button').click();
    await createDialog.getByTestId('org-unit-create-name').fill(childName);
    await createDialog.getByTestId('org-unit-create-submit').click();
    await expect(page.getByTestId('org-unit-name')).toHaveText(childName);
    const childId = new URL(page.url()).searchParams.get('unitId')!;
    expect(childId).not.toBe(parentId);
    await expect(page.getByTestId('org-unit-path')).toContainText(parentName);

    try {
      // ③ 加成員（以畫面加入見下方另一個案例）→ 設為主管與主要部門，各自立即生效
      const added = await apiRequest(token, 'patch', `/org-units/${childId}/members`, {
        add: [{ userId, isManager: false, isPrimary: false }],
      });
      expect(added.status).toBe(200);
      await page.reload();
      const members = page.getByTestId('org-unit-member-section');
      await expect(getByTestIdAndValue(members, 'org-unit-member', userId)).toBeVisible();
      const manager = getByTestIdAndValue(members, 'org-unit-member-manager', userId);
      await manager.click();
      await expect(manager).toHaveAttribute('aria-checked', 'true');
      const primary = getByTestIdAndValue(members, 'org-unit-member-primary', userId);
      await primary.click();
      await expect(primary).toHaveAttribute('aria-checked', 'true');
      await snapshot(page, 'org-unit-member-manager');

      // ④ 上層部門勾「含下層部門」才看得到下層的成員
      await getByTestIdAndValue(page, 'org-unit-tree-node', parentId).click();
      await expect(page.getByTestId('org-unit-name')).toHaveText(parentName);
      await expect(getByTestIdAndValue(members, 'org-unit-member', userId)).toHaveCount(0);
      await members.getByTestId('org-unit-member-include-descendants').click();
      await expect(getByTestIdAndValue(members, 'org-unit-member', userId)).toBeVisible();

      // ⑤ 使用者詳情的「所屬部門」：主要部門、帶上層路徑
      await page.goto(`/user/${userId}`);
      const unitRow = getByTestIdAndValue(
        page.getByTestId('user-org-unit-section'),
        'user-org-unit',
        childId,
      );
      await expect(unitRow).toContainText(childName);
      await expect(unitRow).toContainText(parentName);
      await snapshot(page, 'user-org-unit-section');

      // ⑥ 使用者列表以上層部門（含下層）篩選，篩選寫進網址
      await page.goto('/user');
      const table = page.getByTestId('user-table');
      await table.getByTestId('filter-bar-trigger').click();
      const field = getByTestIdAndValue(page, 'filter-bar-field', 'orgUnit');
      await field.getByTestId('user-org-unit-filter').click();
      await page.getByTestId('select-search').fill(parentName);
      await getByTestIdAndValue(page, 'select-item', parentId).click();
      await field.getByTestId('user-org-unit-filter-descendants').click();
      await page.getByTestId('filter-bar-submit').click();
      await expect(page).toHaveURL(new RegExp(`orgUnitId=${parentId}`));
      await expect(page).toHaveURL(/includeDescendants=true/);
      await expect(table.getByTestId('table-row')).toHaveCount(1);
      await expect(getByTestIdAndValue(table, 'table-row', userId)).toBeVisible();
      await snapshot(page, 'user-list-org-filter');
    } finally {
      await deleteUnits(token, [childId, parentId]);
    }
  });

  test('在部門頁以畫面加成員（伺服器端搜尋使用者）', async ({ page }) => {
    const token = await apiLogin('admin');
    const userName = unique('E2E 畫面加入');
    const userId = await createUser(token, userName);
    const unitId = await createUnit(token, unique('E2E 加成員部門'));
    try {
      await loginAndWaitForHome(page, 'admin');
      await page.goto(`/organization?unitId=${unitId}`);
      const members = page.getByTestId('org-unit-member-section');
      await members.getByTestId('org-unit-member-target').click();
      await page.getByTestId('select-search').fill(userName);
      await getByTestIdAndValue(page, 'select-item', userId).click();
      await members.getByTestId('org-unit-member-add').click();
      await expect(getByTestIdAndValue(members, 'org-unit-member', userId)).toBeVisible();
      await snapshot(page, 'org-unit-member-added');
    } finally {
      await deleteUnits(token, [unitId]);
    }
  });

  test('有下層的部門不能刪；刪掉下層後從回收桶還原', async ({ page }) => {
    const token = await apiLogin('admin');
    const parentName = unique('E2E 刪除上層');
    const childName = unique('E2E 刪除下層');
    const parentId = await createUnit(token, parentName);
    const childId = await createUnit(token, childName, parentId);

    try {
      await loginAndWaitForHome(page, 'admin');

      // ① 上層還有下層：刪除被擋下（409 以 toast 提示），部門仍在
      await page.goto(`/organization?unitId=${parentId}`);
      await page.getByTestId('org-unit-delete-button').click();
      await page.getByTestId('org-unit-delete-confirm').getByTestId('alert-dialog-confirm').click();
      await expect(getByTestIdAndValue(page, 'toast', 'error')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(getByTestIdAndValue(page, 'org-unit-tree-node', parentId)).toBeVisible();

      // ② 刪除下層 → 改選上層
      await page.goto(`/organization?unitId=${childId}`);
      await page.getByTestId('org-unit-delete-button').click();
      await page.getByTestId('org-unit-delete-confirm').getByTestId('alert-dialog-confirm').click();
      await expect(page.getByTestId('org-unit-name')).toHaveText(parentName);
      await expect(getByTestIdAndValue(page, 'org-unit-tree-node', childId)).toHaveCount(0);

      // ③ 回收桶的「部門」分頁還原 → 回到樹上原本的位置
      await page.goto('/trash?type=orgUnit');
      await getByTestIdAndValue(page, 'org-unit-restore', childId).click();
      await expect(getByTestIdAndValue(page, 'org-unit-restore', childId)).toHaveCount(0);
      await page.goto(`/organization?unitId=${childId}`);
      await expect(page.getByTestId('org-unit-name')).toHaveText(childName);
      await expect(page.getByTestId('org-unit-path')).toContainText(parentName);
      await snapshot(page, 'org-unit-restored');
    } finally {
      await deleteUnits(token, [childId, parentId]);
    }
  });

  test('組織圖的編輯模式：在節點下新增部門並改名 → 儲存後清單看得到', async ({ page }) => {
    const token = await apiLogin('admin');
    const rootName = unique('E2E 組織圖');
    const newName = unique('E2E 新部門');
    const rootId = await createUnit(token, rootName);
    let newId: string | undefined;

    try {
      await loginAndWaitForHome(page, 'admin');
      await page.goto('/organization');
      await getByTestIdAndValue(page, 'tab', 'chart').click();
      await expect(page).toHaveURL(/view=chart/);
      const chart = page.getByTestId('org-chart');
      await expect(getByTestIdAndValue(chart, 'org-chart-node', rootId)).toBeVisible();

      // ① 進入編輯 → 選取節點 → 新增下層（只改草稿）
      await chart.getByTestId('org-chart-edit').click();
      await getByTestIdAndValue(chart, 'tree-editor-item', rootId).click();
      await getByTestIdAndValue(chart, 'tree-editor-action', 'add-child').click();
      const draftNode = chart.locator('[data-testid="org-chart-node"][data-new="true"]');
      await expect(draftNode).toHaveCount(1);

      // ② 雙擊改名
      await draftNode.dblclick();
      const rename = page.getByTestId('org-chart-rename-dialog');
      await rename.getByTestId('org-chart-rename-input').fill(newName);
      await rename.getByTestId('org-chart-rename-submit').click();
      await expect(draftNode).toContainText(newName);
      await snapshot(page, 'org-chart-draft');

      // ③ 儲存 → 離開編輯模式，伺服器上有這個部門，上層是剛才選的節點
      await chart.getByTestId('org-chart-save').click();
      await expect(chart.getByTestId('org-chart-edit')).toBeVisible();
      const found = await apiRequest(
        token,
        'get',
        `/org-units?keyword=${encodeURIComponent(newName)}`,
      );
      const units = (
        found.body as { data: { items: Array<{ id: string; name: string; parentId: string }> } }
      ).data.items;
      const saved = units.find((unit) => unit.name === newName);
      expect(saved?.parentId).toBe(rootId);
      newId = saved?.id;

      await getByTestIdAndValue(page, 'tab', 'list').click();
      await expect(getByTestIdAndValue(page, 'org-unit-tree-node', newId!)).toContainText(newName);
      await snapshot(page, 'org-chart-saved');
    } finally {
      await deleteUnits(token, [...(newId ? [newId] : []), rootId]);
    }
  });

  test('auditor 看得到部門與成員，但沒有任何操作', async ({ page }) => {
    const token = await apiLogin('admin');
    const unitId = await createUnit(token, unique('E2E 唯讀部門'));
    try {
      await loginAndWaitForHome(page, 'auditor');
      await page.goto(`/organization?unitId=${unitId}`);
      await expect(page.getByTestId('org-unit-detail')).toBeVisible();
      await expect(page.getByTestId('org-unit-member-section')).toBeVisible();
      await expect(page.getByTestId('org-unit-create-button')).toHaveCount(0);
      await expect(page.getByTestId('org-unit-create-child-button')).toHaveCount(0);
      await expect(page.getByTestId('org-unit-edit-button')).toHaveCount(0);
      await expect(page.getByTestId('org-unit-move-button')).toHaveCount(0);
      await expect(page.getByTestId('org-unit-delete-button')).toHaveCount(0);
      await expect(page.getByTestId('org-unit-member-target')).toHaveCount(0);
      await getByTestIdAndValue(page, 'tab', 'chart').click();
      await expect(page.getByTestId('org-chart')).toBeVisible();
      await expect(page.getByTestId('org-chart-edit')).toHaveCount(0);
      await snapshot(page, 'auditor-read-only');
    } finally {
      await deleteUnits(token, [unitId]);
    }
  });

  test('member 沒有組織選單，直接進網址是 403 頁', async ({ page }) => {
    await loginAndWaitForHome(page, 'member');
    await expect(page.getByTestId('menu-organization')).toHaveCount(0);
    await page.goto('/organization');
    await expect(page.getByTestId('forbidden-page')).toBeVisible();
    await snapshot(page, 'member-forbidden');
  });
});
