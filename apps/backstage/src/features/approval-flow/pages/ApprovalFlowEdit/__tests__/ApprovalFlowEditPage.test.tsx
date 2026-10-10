import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore, resetFeatureStore } from '@/core/feature';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import type { ApprovalFlow } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import { registerApprovalFlowPagePermissions, Routes } from '../../..';
import zhTW from '../../../locales/zh_TW.json';

const {
  fetchList,
  fetchDetail,
  putFlow,
  previewFlow,
  fetchUsers,
  fetchGroups,
  fetchRoles,
  fetchOrgUnits,
  fetchStats,
  resetFlow,
} = vi.hoisted(() => ({
  fetchList: vi.fn(),
  fetchDetail: vi.fn(),
  putFlow: vi.fn(),
  previewFlow: vi.fn(),
  fetchUsers: vi.fn(),
  fetchGroups: vi.fn(),
  fetchRoles: vi.fn(),
  fetchOrgUnits: vi.fn(),
  fetchStats: vi.fn(),
  resetFlow: vi.fn(),
}));
vi.mock('@/apis/approval-flow/reset-approval-flow/fetcher', () => ({
  fetchApprovalFlowResetMutation: resetFlow,
}));
vi.mock('@/apis/approval-flow/get-approval-flow-stats/fetcher', () => ({
  fetchApprovalFlowStatsQuery: fetchStats,
}));
vi.mock('@/apis/approval-flow/get-approval-flow-list/fetcher', () => ({
  fetchApprovalFlowListQuery: fetchList,
}));
vi.mock('@/apis/approval-flow/get-approval-flow-detail/fetcher', () => ({
  fetchApprovalFlowDetailQuery: fetchDetail,
}));
vi.mock('@/apis/approval-flow/put-approval-flow/fetcher', () => ({
  fetchApprovalFlowPutMutation: putFlow,
}));
vi.mock('@/apis/approval-flow/preview-approval-flow/fetcher', () => ({
  fetchApprovalFlowPreviewMutation: previewFlow,
}));
vi.mock('@/apis/user/get-user-list/fetcher', () => ({ fetchUserListQuery: fetchUsers }));
vi.mock('@/apis/group/get-group-list/fetcher', () => ({ fetchGroupListQuery: fetchGroups }));
vi.mock('@/apis/role/get-role-list/fetcher', () => ({ fetchRoleListQuery: fetchRoles }));
vi.mock('@/apis/org-unit/get-org-unit-tree/fetcher', () => ({
  fetchOrgUnitTreeQuery: fetchOrgUnits,
}));

const FLOW: ApprovalFlow = {
  type: 'test.purchase',
  requester: 'user',
  requiredPermissions: [],
  inFlightCount: 0,
  fields: [
    { key: 'amount', type: 'number', options: null, example: null },
    { key: 'category', type: 'enum', options: ['it', 'office'], example: null },
  ],
  flow: {
    id: 'f1',
    enabled: true,
    allowRepeatApprover: false,
    version: 3,
    updatedAt: '2026-10-01T00:00:00.000Z',
    steps: [
      {
        key: 'k-manager',
        name: '部門主管',
        assignee: { kind: 'manager', level: 1 },
        assigneeStatus: { label: '第 1 層主管', available: true, deleted: false },
        requiredApprovals: 1,
        conditions: [],
      },
      {
        key: 'k-finance',
        name: '財務',
        assignee: { kind: 'group', id: 'g-finance' },
        assigneeStatus: { label: '財務部', available: true, deleted: true },
        requiredApprovals: 2,
        conditions: [{ field: 'amount', op: 'gte', value: 50000 }],
      },
    ],
  },
};
const REGISTER: ApprovalFlow = {
  type: 'user.register',
  requester: 'anonymous',
  requiredPermissions: [],
  inFlightCount: 0,
  fields: [{ key: 'emailDomain', type: 'string', options: null, example: null }],
  flow: null,
};

const READER = ['approvalFlow:read', 'user:read', 'group:read', 'role:read'] as PermissionKey[];
const EDITOR = [...READER, 'approvalFlow:update'] as PermissionKey[];
// 儲存與重設成功後回到列表：一起掛上
const routes = [Routes.ApprovalFlowListRoute, Routes.ApprovalFlowEditRoute];

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerApprovalFlowPagePermissions();
  featureStore.setState({
    resolved: true,
    statuses: new Map([
      ['group', 'ready'],
      ['organization', 'ready'],
    ]),
  });
  fetchList.mockReset().mockResolvedValue({
    items: [FLOW, REGISTER],
    assigneeKinds: { user: true, group: true, role: true, manager: true, orgUnit: true },
  });
  fetchDetail
    .mockReset()
    .mockImplementation(({ params }: { params: { type: string } }) =>
      Promise.resolve(params.type === 'user.register' ? REGISTER : FLOW),
    );
  putFlow.mockReset().mockResolvedValue(FLOW);
  resetFlow.mockReset().mockResolvedValue(undefined);
  previewFlow.mockReset().mockResolvedValue({
    steps: [
      {
        key: 'k-manager',
        name: '部門主管',
        skipped: false,
        candidates: [{ userId: 'u-boss', name: 'Boss' }],
        required: 1,
        shortage: null,
      },
      {
        key: 'k-finance',
        name: '財務',
        skipped: true,
        candidates: [],
        required: null,
        shortage: null,
      },
    ],
  });
  fetchUsers
    .mockReset()
    .mockResolvedValue({ items: [], pagination: { offset: 0, limit: 20, total: 0 } });
  fetchGroups.mockReset().mockResolvedValue({
    items: [{ id: 'g-finance', name: '財務部' }],
    pagination: { offset: 0, limit: 200, total: 1 },
  });
  fetchRoles
    .mockReset()
    .mockResolvedValue({ items: [], pagination: { offset: 0, limit: 200, total: 0 } });
  fetchOrgUnits.mockReset().mockResolvedValue({ items: [] });
  fetchStats.mockReset().mockResolvedValue({
    days: 30,
    submitted: 5,
    approved: 3,
    rejected: 1,
    withdrawn: 0,
    averageHours: 30,
    pending: 1,
    currentSteps: [{ name: '財務', pending: 1, shortage: 1 }],
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => resetFeatureStore());

const steps = () => screen.findAllByTestId('approval-flow-step', undefined, { timeout: 5000 });

/** 已儲存的關卡預設收合：展開全部，才看得到表單。 */
async function expandAll() {
  for (const toggle of await screen.findAllByTestId('approval-flow-step-toggle')) {
    if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
  }
}

/** 還沒有流程時先選範本。 */
async function pickTemplate(id: string) {
  const buttons = await screen.findAllByTestId('approval-flow-template', undefined, {
    timeout: 5000,
  });
  fireEvent.click(buttons.find((button) => button.getAttribute('data-value') === id)!);
}

/** 儲存前的影響確認（啟用、停用、進行中的申請）：按確認。 */
async function confirmSave() {
  fireEvent.click(
    within(await screen.findByTestId('approval-flow-save-confirm')).getByTestId(
      'alert-dialog-confirm',
    ),
  );
}

function renameFirstStep(name: string) {
  const [first] = screen.getAllByTestId('approval-flow-step-name');
  if (!first) throw new Error('沒有關卡名稱的輸入框');
  fireEvent.change(first, { target: { value: name } });
}

describe('ApprovalFlowEditPage 的權限（docs/architecture/backend/20-approval.md §9.14）', () => {
  it('有 approvalFlow:update → 可以儲存、新增與刪除關卡', async () => {
    renderRoute(routes, '/system/approval-flows/test.purchase', EDITOR);
    expect(await steps()).toHaveLength(2);
    expect(screen.getByTestId('approval-flow-save')).toBeInTheDocument();
    expect(screen.getByTestId('approval-flow-step-add')).toBeInTheDocument();
    expect(screen.getAllByTestId('approval-flow-step-remove')).toHaveLength(2);
  });

  it('只有 approvalFlow:read → 唯讀：沒有儲存與關卡操作，規則以文字顯示；仍可以試算', async () => {
    renderRoute(routes, '/system/approval-flows/test.purchase', READER);
    await steps();
    await expandAll();
    expect(screen.queryByTestId('approval-flow-save')).toBeNull();
    expect(screen.queryByTestId('approval-flow-step-add')).toBeNull();
    expect(screen.queryByTestId('approval-flow-step-remove')).toBeNull();
    expect(screen.getAllByTestId('approval-flow-assignee-summary')[1]).toHaveTextContent(
      '群組：財務部',
    );
    expect(screen.getByTestId('approval-flow-preview-run')).toBeInTheDocument();
  });

  it('權限未水合 → 不閃現儲存與關卡操作', async () => {
    renderRoute(routes, '/system/approval-flows/test.purchase', 'unhydrated');
    await waitFor(() => expect(fetchDetail).toHaveBeenCalled());
    expect(screen.queryByTestId('approval-flow-save')).toBeNull();
    expect(screen.queryByTestId('approval-flow-step-add')).toBeNull();
  });
});

describe('ApprovalFlowEditPage（docs/architecture/backend/20-approval.md §9.16）', () => {
  it('規則指到已刪除的對象 → 以警示標出', async () => {
    renderRoute(routes, '/system/approval-flows/test.purchase', EDITOR);
    await expandAll();
    const [, finance] = await steps();
    expect(
      within(finance as HTMLElement).getByTestId('approval-flow-assignee-deleted'),
    ).toHaveTextContent('已刪除');
  });

  it('組織管理沒有啟用 → 既有的「主管」規則標示不會指派任何人（不提功能未啟用）；新的規則選不到主管與部門', async () => {
    featureStore.setState({ resolved: true, statuses: new Map([['group', 'ready']]) });
    renderRoute(routes, '/system/approval-flows/test.purchase', EDITOR);
    await expandAll();
    const [manager, finance] = await steps();
    expect(
      within(manager as HTMLElement).getByTestId('approval-flow-assignee-unavailable'),
    ).toHaveTextContent('這條規則目前不會指派任何人');
    expect(screen.queryByText(/未啟用/)).toBeNull();

    fireEvent.click(within(finance as HTMLElement).getByTestId('approval-flow-assignee-kind'));
    await screen.findByRole('listbox');
    const kinds = screen
      .getAllByTestId('select-item')
      .map((item) => item.getAttribute('data-value'));
    expect(kinds).toEqual(['user', 'group', 'role']);
  });

  it('匿名申請的類型（註冊）不提供「主管」規則', async () => {
    renderRoute(routes, '/system/approval-flows/user.register', EDITOR);
    await pickTemplate('blank');
    await steps();
    fireEvent.click(screen.getByTestId('approval-flow-assignee-kind'));
    await screen.findByRole('listbox');
    const kinds = screen
      .getAllByTestId('select-item')
      .map((item) => item.getAttribute('data-value'));
    expect(kinds).toEqual(['user', 'group', 'role', 'orgUnit']);
  });

  it('儲存：送出整份流程並帶開始編輯時的 version', async () => {
    renderRoute(routes, '/system/approval-flows/test.purchase', EDITOR);
    await steps();
    await expandAll();
    renameFirstStep('直屬主管');
    fireEvent.click(screen.getByTestId('approval-flow-save'));
    await waitFor(() => expect(putFlow).toHaveBeenCalledTimes(1));
    expect(putFlow.mock.calls[0]![0]).toMatchObject({
      params: {
        type: 'test.purchase',
        body: {
          version: 3,
          steps: [
            { key: 'k-manager', name: '直屬主管', assignee: { kind: 'manager', level: 1 } },
            {
              key: 'k-finance',
              requiredApprovals: 2,
              conditions: [{ field: 'amount', op: 'gte', value: 50000 }],
            },
          ],
        },
      },
    });
  });

  it('第一次設定流程：不帶 version', async () => {
    renderRoute(routes, '/system/approval-flows/user.register', EDITOR);
    await pickTemplate('blank');
    await steps();
    renameFirstStep('管理者');
    fireEvent.click(screen.getByTestId('approval-flow-assignee-kind'));
    await screen.findByRole('listbox');
    fireEvent.click(
      screen
        .getAllByTestId('select-item')
        .find((item) => item.getAttribute('data-value') === 'group') as HTMLElement,
    );
    fireEvent.click(await screen.findByTestId('approval-flow-assignee-group'));
    await screen.findByRole('listbox');
    fireEvent.click(
      await screen.findByText('財務部', { selector: '[data-testid="select-item"] *' }),
    );
    fireEvent.click(screen.getByTestId('approval-flow-save'));
    // 第一次啟用：說明新的申請會依這個流程審核
    await confirmSave();
    await waitFor(() => expect(putFlow).toHaveBeenCalledTimes(1));
    const body = putFlow.mock.calls[0]![0].params.body;
    expect(body).not.toHaveProperty('version');
    expect(body.steps).toEqual([
      {
        name: '管理者',
        assignee: { kind: 'group', id: 'g-finance' },
        requiredApprovals: 1,
        conditions: [],
      },
    ]);
  });

  it('還沒填完就儲存 → 不送出，標出缺少的欄位', async () => {
    renderRoute(routes, '/system/approval-flows/user.register', EDITOR);
    await pickTemplate('blank');
    await steps();
    fireEvent.click(screen.getByTestId('approval-flow-save'));
    await confirmSave();
    await waitFor(() =>
      expect(screen.getByTestId('approval-flow-step-name')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(screen.getByTestId('approval-flow-step')).toHaveAttribute('data-invalid', 'true');
    expect(putFlow).not.toHaveBeenCalled();
  });

  it('409 APPROVAL_FLOW_VERSION_CONFLICT → 提示已被他人修改；重新載入後改用最新的流程', async () => {
    putFlow.mockRejectedValue(new AppError('APPROVAL_FLOW_VERSION_CONFLICT', 409, { current: 4 }));
    renderRoute(routes, '/system/approval-flows/test.purchase', EDITOR);
    await steps();
    await expandAll();
    renameFirstStep('直屬主管');
    fireEvent.click(screen.getByTestId('approval-flow-save'));

    expect(await screen.findByTestId('approval-flow-conflict')).toHaveTextContent(
      '流程已被他人修改',
    );
    // 草稿留著，讓使用者先把自己的修改記下來
    expect(screen.getAllByTestId('approval-flow-step-name')[0]).toHaveValue('直屬主管');

    fetchDetail.mockResolvedValue({
      ...FLOW,
      flow: {
        ...FLOW.flow!,
        version: 4,
        steps: FLOW.flow!.steps.map((step) =>
          Object.assign({}, step, { name: `${step.name}（新）` }),
        ),
      },
    });
    fireEvent.click(screen.getByTestId('version-conflict-reload'));
    await waitFor(() => expect(screen.queryByTestId('approval-flow-conflict')).toBeNull());
    // 重新載入後是伺服器上的流程：關卡收合，摘要是新的名稱
    expect(screen.getAllByTestId('approval-flow-step')[0]).toHaveTextContent('部門主管（新）');
  });

  it('422 APPROVAL_FLOW_ASSIGNEE_UNAVAILABLE → details.steps 指到的關卡標紅', async () => {
    putFlow.mockRejectedValue(
      new AppError('APPROVAL_FLOW_ASSIGNEE_UNAVAILABLE', 422, { steps: [1] }),
    );
    renderRoute(routes, '/system/approval-flows/test.purchase', EDITOR);
    await steps();
    await expandAll();
    renameFirstStep('直屬主管');
    fireEvent.click(screen.getByTestId('approval-flow-save'));
    await waitFor(() => {
      const [first, second] = screen.getAllByTestId('approval-flow-step');
      expect(second).toHaveAttribute('data-invalid', 'true');
      expect(first).not.toHaveAttribute('data-invalid');
    });
  });

  it('VALIDATION_FAILED → details.fields 的路徑對到條件的值', async () => {
    putFlow.mockRejectedValue(
      new AppError('VALIDATION_FAILED', 400, {
        fields: { 'steps.1.conditions.0.value': 'expected number' },
      }),
    );
    renderRoute(routes, '/system/approval-flows/test.purchase', EDITOR);
    await steps();
    await expandAll();
    renameFirstStep('直屬主管');
    fireEvent.click(screen.getByTestId('approval-flow-save'));
    await waitFor(() =>
      expect(screen.getByTestId('approval-flow-condition-value')).toHaveAttribute(
        'aria-invalid',
        'true',
      ),
    );
  });

  it('試算：帶上未儲存的草稿與欄位值，列出每一關的候選人與略過', async () => {
    renderRoute(routes, '/system/approval-flows/test.purchase', EDITOR);
    await steps();
    await expandAll();
    renameFirstStep('直屬主管');
    const amount = screen
      .getAllByTestId('approval-flow-preview-field')
      .find((input) => input.getAttribute('data-value') === 'amount') as HTMLElement;
    fireEvent.change(amount, { target: { value: '30000' } });
    fireEvent.click(screen.getByTestId('approval-flow-preview-run'));

    await waitFor(() => expect(previewFlow).toHaveBeenCalled());
    expect(previewFlow.mock.calls.at(-1)![0]).toMatchObject({
      params: {
        type: 'test.purchase',
        body: {
          steps: [{ name: '直屬主管' }, { name: '財務' }],
          fields: { amount: 30000, category: null },
          requesterId: null,
        },
      },
    });
    const results = await screen.findAllByTestId('approval-flow-preview-step');
    expect(results[0]).toHaveTextContent('Boss');
    expect(results[0]).toHaveTextContent('需要 1 人同意');
    expect(
      within(results[1] as HTMLElement).getByTestId('approval-flow-preview-skipped'),
    ).toHaveTextContent('略過');
  });
});

describe('流程設定的引導（docs/architecture/backend/20-approval.md §9.16）', () => {
  it('已儲存的關卡收合成一行摘要；點開才是表單', async () => {
    renderRoute(routes, '/system/approval-flows/test.purchase', EDITOR);
    const [, finance] = await steps();
    expect(finance).not.toHaveAttribute('data-expanded');
    expect(
      within(finance as HTMLElement).getByTestId('approval-flow-step-summary-line'),
    ).toHaveTextContent('群組：財務部 · 2 人同意 · 1 個條件');
    expect(screen.queryByTestId('approval-flow-step-name')).toBeNull();

    fireEvent.click(within(finance as HTMLElement).getByTestId('approval-flow-step-toggle'));
    expect(finance).toHaveAttribute('data-expanded', 'true');
    expect(within(finance as HTMLElement).getByTestId('approval-flow-step-name')).toHaveValue(
      '財務',
    );
  });

  it('流程摘要：每一關一個節點與核准後；自動試算後標出略過的關卡', async () => {
    renderRoute(routes, '/system/approval-flows/test.purchase', EDITOR);
    const nodes = await screen.findAllByTestId('approval-flow-summary-step', undefined, {
      timeout: 5000,
    });
    expect(nodes).toHaveLength(2);
    // 不必按「試算」：停 500ms 後自動送出
    await waitFor(() => expect(previewFlow).toHaveBeenCalled(), { timeout: 3000 });
    await waitFor(() =>
      expect(screen.getAllByTestId('approval-flow-summary-step')[1]).toHaveAttribute(
        'data-state',
        'skipped',
      ),
    );
    expect(screen.getAllByTestId('approval-flow-summary-step')[0]).toHaveTextContent('1 位審核者');
  });

  it('點摘要的節點：展開那一關並捲過去', async () => {
    // jsdom 沒有 scrollIntoView
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderRoute(routes, '/system/approval-flows/test.purchase', EDITOR);
    const [, financeNode] = await screen.findAllByTestId('approval-flow-summary-step', undefined, {
      timeout: 5000,
    });
    fireEvent.click(financeNode!);
    await waitFor(() =>
      expect(screen.getAllByTestId('approval-flow-step')[1]).toHaveAttribute(
        'data-expanded',
        'true',
      ),
    );
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });

  it('還沒有流程：先選範本；匿名的類型不列出要找主管的範本', async () => {
    renderRoute(routes, '/system/approval-flows/user.register', EDITOR);
    const buttons = await screen.findAllByTestId('approval-flow-template', undefined, {
      timeout: 5000,
    });
    expect(buttons.map((button) => button.getAttribute('data-value'))).toEqual([
      'role',
      'reviewThenApprove',
      'blank',
    ]);
    expect(screen.queryByTestId('approval-flow-save')).toBeNull();

    await pickTemplate('reviewThenApprove');
    const names = await screen.findAllByTestId('approval-flow-step-name');
    expect(names.map((input) => (input as HTMLInputElement).value)).toEqual(['初審', '最終核准']);
  });

  it('最後一關說明審核者還需要核准這個類型的權限', async () => {
    fetchDetail.mockResolvedValue({
      ...FLOW,
      requiredPermissions: [{ key: 'user:create', nameI18nKey: 'approvalFlow.step.name' }],
    });
    renderRoute(routes, '/system/approval-flows/test.purchase', EDITOR);
    await expandAll();
    const hints = await screen.findAllByTestId('approval-flow-step-permission-hint');
    expect(hints).toHaveLength(1);
    expect(screen.getAllByTestId('approval-flow-step')[1]).toContainElement(hints[0]!);
    expect(hints[0]).toHaveTextContent('關卡名稱');
  });

  it('同意數的說明：指定人數與會簽', async () => {
    renderRoute(routes, '/system/approval-flows/test.purchase', EDITOR);
    await expandAll();
    const hints = screen.getAllByTestId('approval-flow-step-required-hint');
    expect(hints[1]).toHaveTextContent('任 2 位審核者同意就通過這一關');
  });

  it('有進行中的申請：儲存前說明它們照舊版本；取消就不送出', async () => {
    fetchDetail.mockResolvedValue({ ...FLOW, inFlightCount: 2 });
    renderRoute(routes, '/system/approval-flows/test.purchase', EDITOR);
    await expandAll();
    renameFirstStep('直屬主管');
    fireEvent.click(screen.getByTestId('approval-flow-save'));
    const dialog = await screen.findByTestId('approval-flow-save-confirm');
    expect(dialog).toHaveTextContent('進行中的 2 筆申請照送出時的關卡繼續');
    fireEvent.click(within(dialog).getByTestId('alert-dialog-cancel'));
    await waitFor(() => expect(screen.queryByTestId('approval-flow-save-confirm')).toBeNull());
    expect(putFlow).not.toHaveBeenCalled();
  });

  it('實際運作：近 30 天的筆數與卡住的關卡', async () => {
    renderRoute(routes, '/system/approval-flows/test.purchase', READER);
    const stats = await screen.findByTestId('approval-flow-stats', undefined, { timeout: 5000 });
    await waitFor(() => expect(stats).toHaveTextContent('實際運作（近 30 天）'));
    expect(await within(stats).findByTestId('approval-flow-stats-step')).toHaveTextContent(
      '財務：1 筆',
    );
    expect(stats).toHaveTextContent('1 筆找不到審核者');
    expect(stats).toHaveTextContent('30 小時');
  });
});

describe('儲存後離開與重設流程（docs/architecture/backend/20-approval.md §9.16、§12 D10）', () => {
  it('儲存成功：回到審批流程的分頁，不問未儲存', async () => {
    const { router } = renderRoute(routes, '/system/approval-flows/test.purchase', EDITOR);
    await expandAll();
    renameFirstStep('直屬主管');
    fireEvent.click(screen.getByTestId('approval-flow-save'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/system/approval-flows'));
    expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull();
  });

  it('儲存失敗：留在編輯頁，草稿還在', async () => {
    putFlow.mockRejectedValue(new AppError('APPROVAL_FLOW_VERSION_CONFLICT', 409, { current: 4 }));
    const { router } = renderRoute(routes, '/system/approval-flows/test.purchase', EDITOR);
    await expandAll();
    renameFirstStep('直屬主管');
    fireEvent.click(screen.getByTestId('approval-flow-save'));
    await screen.findByTestId('approval-flow-conflict');
    expect(router.state.location.pathname).toBe('/system/approval-flows/test.purchase');
  });

  it('重設：確認後帶目前的版本送出，回到分頁；說明進行中的申請照舊', async () => {
    fetchDetail.mockResolvedValue({ ...FLOW, inFlightCount: 2 });
    const { router } = renderRoute(routes, '/system/approval-flows/test.purchase', EDITOR);
    fireEvent.click(await screen.findByTestId('approval-flow-reset', undefined, { timeout: 5000 }));
    const dialog = await screen.findByTestId('approval-flow-reset-confirm');
    expect(dialog).toHaveTextContent('回到單關審批');
    expect(dialog).toHaveTextContent('進行中的 2 筆申請照送出時的關卡走完');
    fireEvent.click(within(dialog).getByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(resetFlow).toHaveBeenCalledTimes(1));
    expect(resetFlow.mock.calls[0]![0]).toMatchObject({
      params: { type: 'test.purchase', version: 3 },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/system/approval-flows'));
  });

  it('重設：取消就不送出', async () => {
    renderRoute(routes, '/system/approval-flows/test.purchase', EDITOR);
    fireEvent.click(await screen.findByTestId('approval-flow-reset', undefined, { timeout: 5000 }));
    fireEvent.click(
      within(await screen.findByTestId('approval-flow-reset-confirm')).getByTestId(
        'alert-dialog-cancel',
      ),
    );
    await waitFor(() => expect(screen.queryByTestId('approval-flow-reset-confirm')).toBeNull());
    expect(resetFlow).not.toHaveBeenCalled();
  });

  it('還沒有流程（選完範本）或唯讀：沒有重設', async () => {
    renderRoute(routes, '/system/approval-flows/user.register', EDITOR);
    await pickTemplate('blank');
    await steps();
    expect(screen.queryByTestId('approval-flow-reset')).toBeNull();
  });

  it('唯讀（只有 approvalFlow:read）：沒有重設', async () => {
    renderRoute(routes, '/system/approval-flows/test.purchase', READER);
    await steps();
    expect(screen.queryByTestId('approval-flow-reset')).toBeNull();
  });
});
