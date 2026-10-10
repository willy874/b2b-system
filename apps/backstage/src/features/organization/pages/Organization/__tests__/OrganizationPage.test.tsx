import { installFlowDom } from '@b2b-system/ui/testing';
import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore } from '@/core/feature';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerOrganizationPagePermissions, Routes } from '../../..';
import organizationZhTW from '../../../locales/zh_TW.json';

const {
  fetchTree,
  fetchUnit,
  fetchMembers,
  fetchProfile,
  fetchUsers,
  deleteUnit,
  moveUnit,
  updateMembers,
  createUnit,
  updateUnit,
} = vi.hoisted(() => ({
  fetchTree: vi.fn(),
  fetchUnit: vi.fn(),
  fetchMembers: vi.fn(),
  fetchProfile: vi.fn(),
  fetchUsers: vi.fn(),
  deleteUnit: vi.fn(),
  moveUnit: vi.fn(),
  updateMembers: vi.fn(),
  createUnit: vi.fn(),
  updateUnit: vi.fn(),
}));
vi.mock('@/apis/org-unit/get-org-unit-tree/fetcher', () => ({ fetchOrgUnitTreeQuery: fetchTree }));
vi.mock('@/apis/org-unit/get-org-unit-detail/fetcher', () => ({
  fetchOrgUnitDetailQuery: fetchUnit,
}));
vi.mock('@/apis/org-unit/get-org-unit-members/fetcher', () => ({
  fetchOrgUnitMembersQuery: fetchMembers,
}));
vi.mock('@/apis/auth/get-profile/fetcher', () => ({ fetchProfileQuery: fetchProfile }));
vi.mock('@/apis/user/get-user-list/fetcher', () => ({ fetchUserListQuery: fetchUsers }));
vi.mock('@/apis/org-unit/delete-org-unit/fetcher', () => ({
  fetchOrgUnitDeleteMutation: deleteUnit,
}));
vi.mock('@/apis/org-unit/move-org-unit/fetcher', () => ({ fetchOrgUnitMoveMutation: moveUnit }));
vi.mock('@/apis/org-unit/create-org-unit/fetcher', () => ({
  fetchOrgUnitCreateMutation: createUnit,
}));
vi.mock('@/apis/org-unit/update-org-unit/fetcher', () => ({
  fetchOrgUnitUpdateMutation: updateUnit,
}));
vi.mock('@/apis/org-unit/update-org-unit-members/fetcher', () => ({
  fetchOrgUnitMembersUpdateMutation: updateMembers,
}));

const HQ = '11111111-1111-4111-8111-111111111111';
const SALES = '22222222-2222-4222-8222-222222222222';
const NORTH = '33333333-3333-4333-8333-333333333333';
const RD = '44444444-4444-4444-8444-444444444444';

const unit = (id: string, name: string, parentId: string | null, sortOrder: number) => ({
  id,
  parentId,
  name,
  code: null,
  description: null,
  sortOrder,
  memberCount: 1,
  managerCount: 0,
  managers: [],
  version: 2,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});
// 總公司 ─┬─ 業務部 ── 北區
//         └─ 研發部
const UNITS = [
  unit(HQ, '總公司', null, 0),
  unit(SALES, '業務部', HQ, 0),
  unit(NORTH, '北區', SALES, 0),
  unit(RD, '研發部', HQ, 1),
];
const member = (userId: string, displayName: string, extra: object = {}) => ({
  userId,
  displayName,
  email: `${userId}@acme.test`,
  status: 'active',
  unitId: SALES,
  unitName: '業務部',
  isManager: false,
  isPrimary: true,
  title: null,
  ...extra,
});

const READER = ['orgUnit:read', 'user:read'] as PermissionKey[];
const MANAGER = [
  ...READER,
  'orgUnit:create',
  'orgUnit:update',
  'orgUnit:delete',
] as PermissionKey[];
const routes = [Routes.OrganizationRoute];
const SALES_PATH = `/organization?unitId=${SALES}`;

/** 樹上的一個節點（以 `data-value` 定位）。 */
async function treeNode(id: string) {
  const nodes = await screen.findAllByTestId('org-unit-tree-node', undefined, { timeout: 5000 });
  const node = nodes.find((element) => element.getAttribute('data-value') === id);
  if (!node) throw new Error(`樹上沒有部門 ${id}`);
  return node;
}

const visibleNodeIds = () =>
  screen.queryAllByTestId('org-unit-tree-node').map((node) => node.getAttribute('data-value'));

beforeAll(() => {
  installFlowDom();
  initTestI18n(organizationZhTW);
});

beforeEach(() => {
  resetPagePermissionRegistry();
  registerOrganizationPagePermissions();
  fetchTree.mockReset().mockResolvedValue({ items: UNITS });
  fetchUnit.mockReset().mockImplementation(async ({ params }) => {
    const found = UNITS.find((item) => item.id === params.unitId);
    const path = found?.parentId === HQ ? [{ id: HQ, name: '總公司' }] : [];
    return { ...found, path };
  });
  fetchMembers.mockReset().mockResolvedValue({
    items: [member('u-alice', 'Alice'), member('me', 'Myself')],
    pagination: { total: 2 },
  });
  fetchProfile.mockReset().mockResolvedValue({ user: { id: 'me' }, permissions: [] });
  fetchUsers.mockReset().mockResolvedValue({ items: [], pagination: { total: 0 } });
  deleteUnit.mockReset().mockResolvedValue(undefined);
  moveUnit.mockReset().mockImplementation(async ({ params }) => ({
    ...UNITS.find((item) => item.id === params.unitId),
    path: [],
  }));
  updateMembers.mockReset().mockResolvedValue({ ...UNITS[1], path: [] });
  createUnit.mockReset().mockImplementation(async ({ params }) => ({
    ...unit('55555555-5555-4555-8555-555555555555', params.body.name, params.body.parentId, 9),
    path: [],
  }));
  updateUnit.mockReset().mockImplementation(async ({ params }) => ({
    ...UNITS.find((item) => item.id === params.unitId),
    ...params.body,
    version: params.body.version + 1,
    path: [],
  }));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('OrganizationPage 的權限（docs/architecture/backend/23-organization.md §7）', () => {
  it('有 orgUnit:create／update／delete → 顯示新增、搬移、刪除、編輯與成員操作', async () => {
    renderRoute(routes, SALES_PATH, MANAGER);
    expect(
      await screen.findByTestId('org-unit-name', undefined, { timeout: 5000 }),
    ).toHaveTextContent('業務部');
    expect(screen.getByTestId('org-unit-create-button')).toBeInTheDocument();
    expect(screen.getByTestId('org-unit-create-child-button')).toBeInTheDocument();
    expect(screen.getByTestId('org-unit-move-button')).toBeInTheDocument();
    expect(screen.getByTestId('org-unit-delete-button')).toBeInTheDocument();
    expect(screen.getByTestId('org-unit-edit-button')).toBeInTheDocument();
    expect(await screen.findByTestId('org-unit-member-add')).toBeInTheDocument();
  });

  it('只有 orgUnit:read → 看得到樹與詳情，沒有任何操作', async () => {
    renderRoute(routes, SALES_PATH, READER);
    await screen.findByTestId('org-unit-name', undefined, { timeout: 5000 });
    await screen.findAllByTestId('org-unit-member');
    expect(screen.queryByTestId('org-unit-create-button')).toBeNull();
    expect(screen.queryByTestId('org-unit-create-child-button')).toBeNull();
    expect(screen.queryByTestId('org-unit-move-button')).toBeNull();
    expect(screen.queryByTestId('org-unit-delete-button')).toBeNull();
    expect(screen.queryByTestId('org-unit-edit-button')).toBeNull();
    expect(screen.queryByTestId('org-unit-member-add')).toBeNull();
    expect(screen.queryByTestId('org-unit-member-remove')).toBeNull();
  });

  it('沒有 user:read → 不顯示成員表（後端的成員端點要 user:read）', async () => {
    renderRoute(routes, SALES_PATH, ['orgUnit:read'] as PermissionKey[]);
    await screen.findByTestId('org-unit-name', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('org-unit-member-section')).toBeNull();
    expect(fetchMembers).not.toHaveBeenCalled();
  });

  it('權限未水合 → 不閃現操作按鈕', async () => {
    renderRoute(routes, SALES_PATH, 'unhydrated');
    await waitFor(() => expect(screen.queryByTestId('org-unit-create-button')).toBeNull());
    expect(screen.queryByTestId('org-unit-delete-button')).toBeNull();
    expect(screen.queryByTestId('org-unit-member-add')).toBeNull();
  });
});

describe('OrganizationPage 的部門樹', () => {
  it('預設展開最上層與選中部門的上層', async () => {
    renderRoute(routes, `/organization?unitId=${NORTH}`, READER);
    await treeNode(NORTH);
    expect(visibleNodeIds()).toEqual([HQ, SALES, NORTH, RD]);
  });

  it('沒有選部門：樹只展開到第二層，右側提示選擇部門', async () => {
    renderRoute(routes, '/organization', READER);
    await treeNode(SALES);
    expect(visibleNodeIds()).toEqual([HQ, SALES, RD]);
    expect(screen.getByTestId('org-unit-detail-empty')).toBeInTheDocument();
  });

  it('搜尋關鍵字：只留下符合的部門與它們的上層', async () => {
    renderRoute(routes, '/organization', READER);
    await treeNode(HQ);
    fireEvent.change(screen.getByTestId('org-unit-tree-search'), { target: { value: '北' } });
    await waitFor(() => expect(visibleNodeIds()).toEqual([HQ, SALES, NORTH]));
  });

  it('點部門：網址帶 unitId，右側顯示它的詳情與上層路徑', async () => {
    const { router } = renderRoute(routes, '/organization', READER);
    fireEvent.click(await treeNode(RD));
    expect(await screen.findByTestId('org-unit-name')).toHaveTextContent('研發部');
    expect(router.state.location.search).toEqual({ unitId: RD });
    expect(screen.getByTestId('org-unit-path')).toHaveTextContent('總公司');
  });
});

describe('OrganizationPage 的操作', () => {
  it('刪除：確認後呼叫刪除，並改選它的上層', async () => {
    const { router } = renderRoute(routes, SALES_PATH, MANAGER);
    fireEvent.click(
      await screen.findByTestId('org-unit-delete-button', undefined, { timeout: 5000 }),
    );
    const confirm = await screen.findByTestId('org-unit-delete-confirm');
    fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(deleteUnit).toHaveBeenCalledTimes(1));
    expect(deleteUnit.mock.calls[0]![0]).toMatchObject({ params: { unitId: SALES } });
    await waitFor(() => expect(router.state.location.search).toEqual({ unitId: HQ }));
  });

  it('搬移：選最上層後送出新的上層與目前的 version', async () => {
    renderRoute(routes, SALES_PATH, MANAGER);
    fireEvent.click(
      await screen.findByTestId('org-unit-move-button', undefined, { timeout: 5000 }),
    );
    const dialog = await screen.findByTestId('org-unit-move-dialog');
    // 還沒換上層：不能送出
    expect(within(dialog).getByTestId('org-unit-move-submit')).toBeDisabled();

    fireEvent.click(within(dialog).getByTestId('org-unit-move-target'));
    // 選項有下層時是樹（role="tree"）
    await screen.findByRole('tree', { name: '新的上層部門' });
    const options = screen.getAllByTestId('select-item');
    // 第一個選項是「最上層」（值是空字串）
    fireEvent.click(options.find((option) => option.getAttribute('data-value') === '')!);
    fireEvent.click(within(dialog).getByTestId('org-unit-move-submit'));

    await waitFor(() => expect(moveUnit).toHaveBeenCalledTimes(1));
    expect(moveUnit.mock.calls[0]![0]).toMatchObject({
      params: { unitId: SALES, body: { parentId: null, version: 2 } },
    });
  });

  it('成員：切換主管送出差異的 update；自己的那一列沒有操作（D6）', async () => {
    renderRoute(routes, SALES_PATH, MANAGER);
    const switches = await screen.findAllByTestId('org-unit-member-manager', undefined, {
      timeout: 5000,
    });
    expect(switches.map((element) => element.getAttribute('data-value'))).toEqual(['u-alice']);

    fireEvent.click(switches[0]!);
    await waitFor(() => expect(updateMembers).toHaveBeenCalledTimes(1));
    expect(updateMembers.mock.calls[0]![0]).toMatchObject({
      params: {
        unitId: SALES,
        body: { add: [], update: [{ userId: 'u-alice', isManager: true }], remove: [] },
      },
    });
  });

  it('成員：勾「含下層部門」重新查詢，下層部門的成員只顯示、不能改', async () => {
    renderRoute(routes, SALES_PATH, MANAGER);
    await screen.findAllByTestId('org-unit-member-manager', undefined, { timeout: 5000 });
    fetchMembers.mockResolvedValue({
      items: [member('u-bob', 'Bob', { unitId: NORTH, unitName: '北區' })],
      pagination: { total: 1 },
    });
    fireEvent.click(screen.getByTestId('org-unit-member-include-descendants'));

    await waitFor(() =>
      expect(fetchMembers).toHaveBeenLastCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ includeDescendants: true }) }),
      ),
    );
    const row = await screen.findByText('Bob');
    expect(row.closest('li')).toHaveTextContent('北區');
    expect(screen.queryByTestId('org-unit-member-manager')).toBeNull();
  });
});

const CHART_PATH = '/organization?view=chart';

/** 編輯模式雙擊節點改名（只改草稿）。 */
async function renameInChart(id: string, name: string) {
  // 進入編輯模式後 React Flow 會重新掛載節點：雙擊最新的那一個
  await waitFor(async () => {
    fireEvent.doubleClick(await chartNode(id));
    expect(screen.getByTestId('org-chart-rename-dialog')).toBeInTheDocument();
  });
  const dialog = screen.getByTestId('org-chart-rename-dialog');
  fireEvent.change(within(dialog).getByTestId('org-chart-rename-input'), {
    target: { value: name },
  });
  fireEvent.click(within(dialog).getByTestId('org-chart-rename-submit'));
}

/** 組織圖上的一個節點（以 `data-value` 定位）。 */
async function chartNode(id: string) {
  const nodes = await screen.findAllByTestId('org-chart-node', undefined, { timeout: 5000 });
  const node = nodes.find((element) => element.getAttribute('data-value') === id);
  if (!node) throw new Error(`組織圖上沒有部門 ${id}`);
  return node;
}

describe('OrganizationPage 的組織圖（docs/architecture/backend/23-organization.md §8）', () => {
  it('有 orgUnit:create／update／delete → 畫出整棵樹，可以進入編輯模式', async () => {
    renderRoute(routes, CHART_PATH, MANAGER);
    await chartNode(NORTH);
    expect(screen.getAllByTestId('org-chart-node')).toHaveLength(4);
    expect(screen.getByTestId('org-chart-edit')).toBeInTheDocument();
    // 組織圖有自己的編輯模式，頁首的「新增最上層部門」只在清單
    expect(screen.queryByTestId('org-unit-create-button')).toBeNull();
  });

  it('只有 orgUnit:read → 只能看，沒有編輯按鈕', async () => {
    renderRoute(routes, CHART_PATH, READER);
    await chartNode(HQ);
    expect(screen.queryByTestId('org-chart-edit')).toBeNull();
  });

  it('權限未水合 → 不閃現編輯按鈕', async () => {
    renderRoute(routes, CHART_PATH, 'unhydrated');
    await waitFor(() => expect(fetchTree).toHaveBeenCalled());
    expect(screen.queryByTestId('org-chart-edit')).toBeNull();
  });

  it('檢視模式點部門：網址帶 unitId，下方顯示它的詳情', async () => {
    const { router } = renderRoute(routes, CHART_PATH, READER);
    fireEvent.click(await chartNode(RD));
    expect(await screen.findByTestId('org-unit-name')).toHaveTextContent('研發部');
    expect(router.state.location.search).toEqual({ unitId: RD, view: 'chart' });
  });

  it('切換分頁：清單不寫進網址', async () => {
    const { router } = renderRoute(routes, CHART_PATH, READER);
    await chartNode(HQ);
    fireEvent.click(screen.getByRole('tab', { name: '清單' }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(await screen.findAllByTestId('org-unit-tree-node')).not.toHaveLength(0);
  });

  it('編輯：新增下層與改名只改草稿，儲存時依序呼叫 API', async () => {
    renderRoute(routes, CHART_PATH, MANAGER);
    await chartNode(HQ);
    fireEvent.click(screen.getByTestId('org-chart-edit'));
    expect(screen.getByTestId('org-chart-save')).toBeDisabled();

    // 業務部底下新增一個部門
    const addChild = await screen.findAllByTestId('tree-editor-add-child');
    fireEvent.click(addChild.find((button) => button.getAttribute('data-value') === SALES)!);
    // 研發部改名
    await renameInChart(RD, '產品研發部');

    await waitFor(() =>
      expect(screen.getByTestId('org-chart-change-count')).toHaveAttribute('data-value', '2'),
    );
    expect(createUnit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('org-chart-save'));

    await waitFor(() => expect(updateUnit).toHaveBeenCalledTimes(1));
    expect(createUnit.mock.calls[0]![0]).toMatchObject({
      params: { body: { name: '新部門', parentId: SALES } },
    });
    expect(updateUnit.mock.calls[0]![0]).toMatchObject({
      params: { unitId: RD, body: { name: '產品研發部', version: 2 } },
    });
    // 儲存後回到檢視模式
    expect(await screen.findByTestId('org-chart-edit')).toBeInTheDocument();
  });

  it('儲存中途失敗：停在那一步並說明，前面的步驟已生效', async () => {
    updateUnit.mockRejectedValue(new Error('boom'));
    renderRoute(routes, CHART_PATH, MANAGER);
    await chartNode(HQ);
    fireEvent.click(screen.getByTestId('org-chart-edit'));
    await renameInChart(RD, '產品研發部');
    fireEvent.click(await screen.findByTestId('org-chart-save'));

    expect(await screen.findByTestId('org-chart-save-failure')).toHaveTextContent('改名「研發部」');
  });

  it('取消：有變更時先確認', async () => {
    renderRoute(routes, CHART_PATH, MANAGER);
    await chartNode(HQ);
    fireEvent.click(screen.getByTestId('org-chart-edit'));
    const addChild = await screen.findAllByTestId('tree-editor-add-child');
    fireEvent.click(addChild[0]!);
    await waitFor(() =>
      expect(screen.getByTestId('org-chart-change-count')).toHaveAttribute('data-value', '1'),
    );

    fireEvent.click(screen.getByTestId('org-chart-cancel'));
    const confirm = await screen.findByTestId('org-chart-cancel-confirm');
    fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));
    expect(await screen.findByTestId('org-chart-edit')).toBeInTheDocument();
    expect(screen.getAllByTestId('org-chart-node')).toHaveLength(4);
  });
});

describe('OrganizationPage 的匯出、匯入入口（docs/architecture/backend/22-data-transfer.md §12.3）', () => {
  afterEach(() => {
    featureStore.setState({ resolved: true, statuses: new Map() });
  });

  it('有 orgUnit:export、orgUnit:update → 匯出可以選部門或目前部門的成員', async () => {
    featureStore.setState({ resolved: true, statuses: new Map([['dataTransfer', 'ready']]) });
    renderRoute(routes, SALES_PATH, [...MANAGER, 'orgUnit:export'] as PermissionKey[]);
    await screen.findByTestId('org-unit-name', undefined, { timeout: 5000 });
    fireEvent.click(screen.getByTestId('org-unit-export-button'));
    expect(await screen.findByText('部門成員（目前部門與下層）')).toBeInTheDocument();
    expect(screen.getByTestId('org-unit-import-button')).toBeInTheDocument();
  });

  it('只有 orgUnit:read → 不顯示匯出、匯入', async () => {
    featureStore.setState({ resolved: true, statuses: new Map([['dataTransfer', 'ready']]) });
    renderRoute(routes, SALES_PATH, READER);
    await screen.findByTestId('org-unit-name', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('org-unit-export-button')).toBeNull();
    expect(screen.queryByTestId('org-unit-import-button')).toBeNull();
  });
});

async function openEditor() {
  renderRoute(routes, SALES_PATH, MANAGER);
  fireEvent.click(await screen.findByTestId('org-unit-edit-button', undefined, { timeout: 5000 }));
  return screen.findByTestId('org-unit-edit-form');
}

describe('OrganizationPage 的部門基本資料（OrgUnitBasicSection）', () => {
  it('檢視：沒有代碼顯示「-」', async () => {
    renderRoute(routes, SALES_PATH, READER);
    expect(
      await screen.findByTestId('org-unit-code', undefined, { timeout: 5000 }),
    ).toHaveTextContent('-');
  });

  it('編輯：聚焦名稱；代碼與說明去掉空白，清空的送 null，帶開始編輯時的版本', async () => {
    const form = await openEditor();
    const name = within(form).getByTestId('org-unit-name-edit-input');
    expect(name).toHaveValue('業務部');
    expect(name).toHaveFocus();

    fireEvent.change(name, { target: { value: '業務處' } });
    fireEvent.change(within(form).getByTestId('org-unit-code-edit-input'), {
      target: { value: '  SALES  ' },
    });
    fireEvent.change(form.querySelector('textarea')!, { target: { value: '   ' } });
    fireEvent.click(within(form).getByTestId('org-unit-save-button'));

    await waitFor(() => expect(updateUnit).toHaveBeenCalledTimes(1));
    expect(updateUnit.mock.calls[0]![0]).toMatchObject({
      params: {
        unitId: SALES,
        body: { name: '業務處', code: 'SALES', description: null, version: 2 },
      },
    });
    await waitFor(() => expect(screen.queryByTestId('org-unit-edit-form')).toBeNull());
  });

  it('名稱空白不能儲存；取消回到檢視', async () => {
    const form = await openEditor();
    fireEvent.change(within(form).getByTestId('org-unit-name-edit-input'), {
      target: { value: ' ' },
    });
    expect(within(form).getByTestId('org-unit-save-button')).toBeDisabled();
    fireEvent.click(within(form).getByRole('button', { name: '取消' }));
    expect(screen.queryByTestId('org-unit-edit-form')).toBeNull();
    expect(updateUnit).not.toHaveBeenCalled();
  });

  it('代碼重複 → 以 toast 顯示錯誤，輸入保留', async () => {
    updateUnit.mockRejectedValue(new AppError('ORG_UNIT_CODE_DUPLICATE', 409));
    const form = await openEditor();
    fireEvent.change(within(form).getByTestId('org-unit-code-edit-input'), {
      target: { value: 'HQ' },
    });
    fireEvent.click(within(form).getByTestId('org-unit-save-button'));
    expect(await screen.findByText('部門代碼已被使用。')).toBeInTheDocument();
    expect(screen.getByTestId('org-unit-code-edit-input')).toHaveValue('HQ');
  });

  it('版本衝突 → 重新載入後以最新的內容與版本為基礎；重新載入失敗以 toast 顯示', async () => {
    updateUnit.mockRejectedValueOnce(new AppError('ORG_UNIT_VERSION_CONFLICT', 409));
    const form = await openEditor();
    fireEvent.click(within(form).getByTestId('org-unit-save-button'));
    await screen.findByTestId('version-conflict-alert');

    fetchUnit.mockResolvedValueOnce({
      ...UNITS[1],
      name: '營業部',
      code: 'BIZ',
      description: '新的說明',
      version: 7,
      path: [],
    });
    fireEvent.click(screen.getByTestId('version-conflict-reload'));
    await waitFor(() =>
      expect(screen.getByTestId('org-unit-name-edit-input')).toHaveValue('營業部'),
    );
    expect(screen.getByTestId('org-unit-code-edit-input')).toHaveValue('BIZ');

    fireEvent.click(screen.getByTestId('org-unit-save-button'));
    await waitFor(() => expect(updateUnit).toHaveBeenCalledTimes(2));
    expect(updateUnit.mock.calls[1]![0]).toMatchObject({
      params: { body: { name: '營業部', code: 'BIZ', description: '新的說明', version: 7 } },
    });
  });

  it('重新載入失敗 → 以 toast 顯示錯誤', async () => {
    updateUnit.mockRejectedValueOnce(new AppError('ORG_UNIT_VERSION_CONFLICT', 409));
    const form = await openEditor();
    fireEvent.click(within(form).getByTestId('org-unit-save-button'));
    await screen.findByTestId('version-conflict-alert');

    fetchUnit.mockRejectedValueOnce(new AppError('ORG_UNIT_NOT_FOUND', 404));
    fireEvent.click(screen.getByTestId('version-conflict-reload'));
    expect(await screen.findByText('找不到這個部門。')).toBeInTheDocument();
  });
});

describe('OrganizationPage 的新增部門（OrgUnitCreateDialog）', () => {
  it('新增最上層：名稱必填，送出後選中新的部門', async () => {
    const { router } = renderRoute(routes, '/organization', MANAGER);
    fireEvent.click(
      await screen.findByTestId('org-unit-create-button', undefined, { timeout: 5000 }),
    );
    const dialog = await screen.findByTestId('org-unit-create-dialog');
    expect(dialog).toHaveTextContent('新增在最上層。');
    expect(within(dialog).getByTestId('org-unit-create-submit')).toBeDisabled();

    fireEvent.change(within(dialog).getByTestId('org-unit-create-name'), {
      target: { value: '財務部' },
    });
    fireEvent.change(within(dialog).getByTestId('org-unit-create-code'), {
      target: { value: ' FIN ' },
    });
    fireEvent.click(within(dialog).getByTestId('org-unit-create-submit'));

    await waitFor(() => expect(createUnit).toHaveBeenCalledTimes(1));
    expect(createUnit.mock.calls[0]![0]).toMatchObject({
      params: { body: { name: '財務部', parentId: null, code: 'FIN', description: null } },
    });
    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        unitId: '55555555-5555-4555-8555-555555555555',
      }),
    );
    await waitFor(() => expect(screen.queryByTestId('org-unit-create-dialog')).toBeNull());
  });

  it('新增下層：說明在哪個部門之下，送出它的 id 為上層；在表單按 Enter 也能送出', async () => {
    renderRoute(routes, SALES_PATH, MANAGER);
    fireEvent.click(
      await screen.findByTestId('org-unit-create-child-button', undefined, { timeout: 5000 }),
    );
    const dialog = await screen.findByTestId('org-unit-create-dialog');
    expect(dialog).toHaveTextContent('新增在「業務部」之下。');

    const name = within(dialog).getByTestId('org-unit-create-name');
    fireEvent.change(name, { target: { value: '南區' } });
    fireEvent.change(dialog.querySelector('textarea')!, { target: { value: ' 南部據點 ' } });
    fireEvent.submit(name.closest('form')!);

    await waitFor(() => expect(createUnit).toHaveBeenCalledTimes(1));
    expect(createUnit.mock.calls[0]![0]).toMatchObject({
      params: { body: { name: '南區', parentId: SALES, code: null, description: '南部據點' } },
    });
  });

  it('送出失敗 → 錯誤顯示在對話框裡；取消後重新開啟是空白表單', async () => {
    createUnit.mockRejectedValue(new AppError('ORG_UNIT_NAME_DUPLICATE', 409));
    renderRoute(routes, '/organization', MANAGER);
    fireEvent.click(
      await screen.findByTestId('org-unit-create-button', undefined, { timeout: 5000 }),
    );
    let dialog = await screen.findByTestId('org-unit-create-dialog');
    fireEvent.change(within(dialog).getByTestId('org-unit-create-name'), {
      target: { value: '總公司' },
    });
    fireEvent.click(within(dialog).getByTestId('org-unit-create-submit'));
    expect(await within(dialog).findByText('同一層已有同名的部門。')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByTestId('org-unit-create-dialog')).toBeNull());

    fireEvent.click(screen.getByTestId('org-unit-create-button'));
    dialog = await screen.findByTestId('org-unit-create-dialog');
    expect(within(dialog).getByTestId('org-unit-create-name')).toHaveValue('');
    expect(within(dialog).queryByText('同一層已有同名的部門。')).toBeNull();
  });
});

describe('OrganizationPage 的部門成員（OrgUnitMemberSection）', () => {
  it('切換主要部門送出 isPrimary 的差異', async () => {
    renderRoute(routes, SALES_PATH, MANAGER);
    const [primary] = await screen.findAllByTestId('org-unit-member-primary', undefined, {
      timeout: 5000,
    });
    fireEvent.click(primary!);
    await waitFor(() => expect(updateMembers).toHaveBeenCalledTimes(1));
    expect(updateMembers.mock.calls[0]![0]).toMatchObject({
      params: {
        unitId: SALES,
        body: { add: [], update: [{ userId: 'u-alice', isPrimary: false }], remove: [] },
      },
    });
  });

  it('編輯職稱：帶入目前的職稱，送出去頭尾空白的值；清空送 null', async () => {
    fetchMembers.mockResolvedValue({
      items: [member('u-alice', 'Alice', { title: '經理' })],
      pagination: { total: 1 },
    });
    renderRoute(routes, SALES_PATH, MANAGER);
    fireEvent.click(
      await screen.findByTestId('org-unit-member-title', undefined, { timeout: 5000 }),
    );
    let dialog = await screen.findByTestId('org-unit-member-title-dialog');
    const input = within(dialog).getByTestId('org-unit-member-title-input');
    expect(input).toHaveValue('經理');
    fireEvent.change(input, { target: { value: '  協理 ' } });
    fireEvent.click(within(dialog).getByTestId('org-unit-member-title-submit'));
    await waitFor(() => expect(updateMembers).toHaveBeenCalledTimes(1));
    expect(updateMembers.mock.calls[0]![0]).toMatchObject({
      params: { body: { update: [{ userId: 'u-alice', title: '協理' }] } },
    });
    await waitFor(() => expect(screen.queryByTestId('org-unit-member-title-dialog')).toBeNull());

    fireEvent.click(screen.getByTestId('org-unit-member-title'));
    dialog = await screen.findByTestId('org-unit-member-title-dialog');
    fireEvent.change(within(dialog).getByTestId('org-unit-member-title-input'), {
      target: { value: '  ' },
    });
    fireEvent.click(within(dialog).getByTestId('org-unit-member-title-submit'));
    await waitFor(() => expect(updateMembers).toHaveBeenCalledTimes(2));
    expect(updateMembers.mock.calls[1]![0]).toMatchObject({
      params: { body: { update: [{ userId: 'u-alice', title: null }] } },
    });
  });

  it('移除成員要先確認，確認後送出 remove', async () => {
    renderRoute(routes, SALES_PATH, MANAGER);
    const [remove] = await screen.findAllByTestId('org-unit-member-remove', undefined, {
      timeout: 5000,
    });
    fireEvent.click(remove!);
    const confirm = await screen.findByTestId('org-unit-member-remove-confirm');
    expect(confirm).toHaveTextContent('「Alice」不再屬於這個部門');
    expect(updateMembers).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: '移除' }));
    await waitFor(() => expect(updateMembers).toHaveBeenCalledTimes(1));
    expect(updateMembers.mock.calls[0]![0]).toMatchObject({
      params: { unitId: SALES, body: { add: [], update: [], remove: ['u-alice'] } },
    });
  });

  it('加入成員：選了使用者才能加入，送出 add', async () => {
    fetchUsers.mockResolvedValue({
      items: [{ id: 'u-carol', displayName: 'Carol', email: 'carol@acme.test' }],
      pagination: { total: 1 },
    });
    renderRoute(routes, SALES_PATH, MANAGER);
    const add = await screen.findByTestId('org-unit-member-add', undefined, { timeout: 5000 });
    expect(add).toBeDisabled();

    fireEvent.click(screen.getByTestId('org-unit-member-target'));
    fireEvent.click(await screen.findByRole('option', { name: /Carol/ }));
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);

    await waitFor(() => expect(updateMembers).toHaveBeenCalledTimes(1));
    expect(updateMembers.mock.calls[0]![0]).toMatchObject({
      params: { unitId: SALES, body: { add: [{ userId: 'u-carol' }], update: [], remove: [] } },
    });
    await waitFor(() => expect(add).toBeDisabled());
  });

  it('沒有成員時顯示「無」；超過一頁時可以換頁', async () => {
    fetchMembers.mockResolvedValue({ items: [], pagination: { total: 0 } });
    const { unmount } = renderRoute(routes, SALES_PATH, READER);
    const list = await screen.findByTestId('org-unit-member-list', undefined, { timeout: 5000 });
    await waitFor(() => expect(list).not.toHaveTextContent('…'));
    expect(within(list).queryByTestId('org-unit-member')).toBeNull();
    unmount();

    fetchMembers.mockResolvedValue({
      items: [member('u-alice', 'Alice')],
      pagination: { total: 120 },
    });
    renderRoute(routes, SALES_PATH, READER);
    await screen.findAllByTestId('org-unit-member', undefined, { timeout: 5000 });
    fireEvent.click(screen.getByTestId('pagination-next'));
    await waitFor(() =>
      expect(fetchMembers).toHaveBeenLastCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ offset: 50, limit: 50 }) }),
      ),
    );
  });

  it('成員查詢失敗 → 顯示錯誤與重試，標題不寫「成員（0）」（docs/architecture/frontend/07-ui-system.md §6.1）', async () => {
    fetchMembers.mockRejectedValueOnce(new AppError('INTERNAL_ERROR', 500));
    renderRoute(routes, SALES_PATH, READER);
    const error = await screen.findByTestId('org-unit-member-error', undefined, { timeout: 5000 });
    expect(screen.getByTestId('org-unit-member-section')).not.toHaveTextContent('成員（0）');
    fireEvent.click(within(error).getByTestId('query-error-retry'));
    expect(await screen.findAllByTestId('org-unit-member')).toHaveLength(2);
  });

  it('移除最後一頁唯一的成員 → 退回上一頁，不卡在空頁（docs/architecture/frontend/07-ui-system.md §6.1）', async () => {
    fetchMembers.mockImplementation(async ({ params }) =>
      params.offset === 0
        ? { items: [member('u-alice', 'Alice')], pagination: { total: 50 } }
        : { items: [], pagination: { total: 50 } },
    );
    fetchMembers.mockResolvedValueOnce({
      items: [member('u-alice', 'Alice')],
      pagination: { total: 51 },
    });
    renderRoute(routes, SALES_PATH, READER);
    fireEvent.click(
      within(
        await screen.findByTestId('org-unit-member-pagination', undefined, { timeout: 5000 }),
      ).getByTestId('pagination-next'),
    );
    await waitFor(() =>
      expect(fetchMembers).toHaveBeenLastCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ offset: 0 }) }),
      ),
    );
    expect(await screen.findByTestId('org-unit-member')).toHaveAttribute('data-value', 'u-alice');
  });
});

describe('OrganizationPage 的其他操作', () => {
  it('刪除失敗 → 對話框留著，不改選部門', async () => {
    deleteUnit.mockRejectedValue(new AppError('ORG_UNIT_HAS_CHILDREN', 409));
    const { router } = renderRoute(routes, SALES_PATH, MANAGER);
    fireEvent.click(
      await screen.findByTestId('org-unit-delete-button', undefined, { timeout: 5000 }),
    );
    const confirm = await screen.findByTestId('org-unit-delete-confirm');
    fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));
    expect(await screen.findByText('還有下層部門，請先刪除或搬走下層部門。')).toBeInTheDocument();
    expect(screen.getByTestId('org-unit-delete-confirm')).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ unitId: SALES });
  });

  it('部門讀不到 → 可以回到組織（清掉 unitId）', async () => {
    fetchUnit.mockRejectedValue(new AppError('ORG_UNIT_NOT_FOUND', 404));
    const { router } = renderRoute(routes, SALES_PATH, READER);
    fireEvent.click(
      await screen.findByTestId('org-unit-detail-back', undefined, { timeout: 5000 }),
    );
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(await screen.findByTestId('org-unit-detail-empty')).toBeInTheDocument();
  });

  it('切到組織圖：保留選中的部門，網址帶 view=chart', async () => {
    const { router } = renderRoute(routes, SALES_PATH, READER);
    await screen.findByTestId('org-unit-name', undefined, { timeout: 5000 });
    fireEvent.click(screen.getByRole('tab', { name: '組織圖' }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ unitId: SALES, view: 'chart' }),
    );
    expect(await screen.findByTestId('org-chart')).toBeInTheDocument();
  });

  it('部門樹讀取失敗 → 組織圖顯示錯誤並可重試', async () => {
    fetchTree.mockRejectedValueOnce(new AppError('INTERNAL_ERROR', 500));
    renderRoute(routes, CHART_PATH, READER);
    const retry = await screen.findByTestId('query-error-retry', undefined, { timeout: 5000 });
    fireEvent.click(retry);
    expect(await screen.findByTestId('org-chart')).toBeInTheDocument();
    expect(fetchTree).toHaveBeenCalledTimes(2);
  });
});

const chartItem = async (id: string) => {
  await chartNode(id);
  const item = screen
    .getAllByTestId('tree-editor-item')
    .find((element) => element.getAttribute('data-value') === id);
  if (!item) throw new Error(`組織圖上沒有可選取的部門 ${id}`);
  return item;
};
const deleteAction = () =>
  within(screen.getByTestId('tree-editor-toolbar'))
    .getAllByTestId('tree-editor-action')
    .find((element) => element.getAttribute('data-value') === 'delete')!;

async function selectAndDelete(permissions: PermissionKey[], id: string) {
  renderRoute(routes, CHART_PATH, permissions);
  await chartNode(HQ);
  fireEvent.click(screen.getByTestId('org-chart-edit'));
  await waitFor(async () => {
    fireEvent.click(await chartItem(id));
    expect(deleteAction()).not.toHaveAttribute('aria-disabled');
  });
  fireEvent.click(deleteAction());
}

describe('OrganizationPage 的組織圖刪除（OrgChartPanel 的 onBeforeDelete）', () => {
  it('刪除有下層的部門：確認時說明下層會變成最上層，確認後計入變更', async () => {
    await selectAndDelete(MANAGER, SALES);
    const confirm = await screen.findByTestId('org-chart-delete-confirm');
    expect(confirm).toHaveTextContent('留下的下層部門會變成最上層');
    fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));
    // 刪除本身＋留下的下層換上層
    await waitFor(() =>
      expect(screen.getByTestId('org-chart-change-count')).toHaveAttribute('data-value', '2'),
    );
    expect(screen.queryByTestId('org-chart-delete-confirm')).toBeNull();
    expect(deleteUnit).not.toHaveBeenCalled();
  });

  it('刪除沒有下層的部門：一般的確認說明', async () => {
    await selectAndDelete(MANAGER, NORTH);
    const confirm = await screen.findByTestId('org-chart-delete-confirm');
    expect(confirm).toHaveTextContent('將刪除 1 個部門（儲存後才生效）');
    expect(confirm).not.toHaveTextContent('最上層');
  });

  it('沒有 orgUnit:delete → 不能刪除既有的部門，以 toast 說明', async () => {
    await selectAndDelete(
      [...READER, 'orgUnit:create', 'orgUnit:update'] as PermissionKey[],
      NORTH,
    );
    expect(await screen.findByText('你沒有刪除部門的權限')).toBeInTheDocument();
    expect(screen.queryByTestId('org-chart-delete-confirm')).toBeNull();
  });

  it('沒有 orgUnit:update → 不能刪除會留下下層的部門（下層要換上層）', async () => {
    await selectAndDelete(
      [...READER, 'orgUnit:create', 'orgUnit:delete'] as PermissionKey[],
      SALES,
    );
    expect(
      await screen.findByText('刪除後下層部門要換上層，你沒有編輯部門的權限'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('org-chart-delete-confirm')).toBeNull();
  });
});
