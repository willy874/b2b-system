import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderRoute } from '@b2b-system/web-core/testing';
import { renderHook, screen, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry, usePageAccess } from '@/core/permission';
import type { ApprovalFlow } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import { registerApprovalFlowPagePermissions, Routes } from '../../..';
import zhTW from '../../../locales/zh_TW.json';

const { fetchList, fetchStats } = vi.hoisted(() => ({ fetchList: vi.fn(), fetchStats: vi.fn() }));
vi.mock('@/apis/approval-flow/get-approval-flow-list/fetcher', () => ({
  fetchApprovalFlowListQuery: fetchList,
}));
vi.mock('@/apis/approval-flow/get-approval-flow-stats/fetcher', () => ({
  fetchApprovalFlowStatsQuery: fetchStats,
}));

const NO_STATS = {
  days: 30,
  submitted: 0,
  approved: 0,
  rejected: 0,
  withdrawn: 0,
  averageHours: null,
  pending: 0,
  currentSteps: [],
};

const STEP = {
  key: 'k1',
  name: '管理者',
  assignee: { kind: 'role', id: 'r1' },
  assigneeStatus: { label: 'admin', available: true, deleted: false },
  requiredApprovals: 1,
  conditions: [],
} satisfies NonNullable<ApprovalFlow['flow']>['steps'][number];

const ITEMS: ApprovalFlow[] = [
  {
    type: 'user.register',
    requester: 'anonymous',
    requiredPermissions: [],
    inFlightCount: 0,
    fields: [{ key: 'emailDomain', type: 'string', options: null, example: null }],
    flow: {
      id: 'f1',
      enabled: true,
      allowRepeatApprover: false,
      version: 2,
      updatedAt: '2026-10-01T00:00:00.000Z',
      steps: [
        STEP,
        {
          ...STEP,
          key: 'k2',
          name: '部門主管',
          assignee: { kind: 'orgUnit', id: 'o1' },
          assigneeStatus: { label: '北區', available: false, deleted: false },
        },
      ],
    },
  },
  {
    type: 'future.type',
    requester: 'user',
    fields: [],
    requiredPermissions: [],
    inFlightCount: 0,
    flow: null,
  },
];

const READER = ['approvalFlow:read'] as PermissionKey[];
// 卡片連到編輯頁：一起掛上，連結才解析得到 href
const routes = [Routes.ApprovalFlowListRoute, Routes.ApprovalFlowEditRoute];

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerApprovalFlowPagePermissions();
  fetchList.mockReset().mockResolvedValue({
    items: ITEMS,
    assigneeKinds: { user: true, group: true, role: true, manager: false, orgUnit: false },
  });
  fetchStats.mockReset().mockResolvedValue(NO_STATS);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('審批流程列表的頁面權限（docs/architecture/backend/20-approval.md §9.14）', () => {
  it('有 approvalFlow:read → 進得去', () => {
    usePermissionStore.setState({ permissions: new Set(READER), hydrated: true });
    expect(renderHook(() => usePageAccess('/system/approval-flows')).result.current).toMatchObject({
      gated: true,
      canAccess: true,
    });
    // 編輯頁以路徑前綴沿用同一個頁面權限
    expect(
      renderHook(() => usePageAccess('/system/approval-flows/user.register')).result.current,
    ).toMatchObject({
      gated: true,
      canAccess: true,
    });
  });

  it('沒有 approvalFlow:read → 不能進', () => {
    usePermissionStore.setState({
      permissions: new Set(['approval:read'] as PermissionKey[]),
      hydrated: true,
    });
    expect(renderHook(() => usePageAccess('/system/approval-flows')).result.current).toMatchObject({
      gated: true,
      canAccess: false,
    });
  });

  it('權限未水合 → 還不能判斷（不閃現內容，也不閃 403）', () => {
    usePermissionStore.setState({ permissions: new Set(), hydrated: false });
    expect(renderHook(() => usePageAccess('/system/approval-flows')).result.current).toMatchObject({
      hydrated: false,
      gated: true,
    });
  });
});

describe('ApprovalFlowListPage（docs/architecture/backend/20-approval.md §9.16）', () => {
  it('每一種類型一張卡片：類型名稱（不認得的顯示原字串）、審批方式、關卡與版本', async () => {
    renderRoute(routes, '/system/approval-flows', READER);
    const cards = await screen.findAllByTestId('approval-flow-card', undefined, { timeout: 5000 });
    expect(
      cards.map((card) => within(card).getByTestId('approval-flow-type-link').textContent),
    ).toEqual(['使用者註冊', 'future.type']);

    const statuses = cards.map((card) => within(card).getByTestId('approval-flow-status'));
    expect(statuses.map((status) => status.getAttribute('data-value'))).toEqual([
      'enabled',
      'unset',
    ]);
    expect(statuses.map((status) => status.textContent)).toEqual(['多階段審批', '單關審批']);
    expect(
      within(cards[0]!)
        .getAllByTestId('approval-flow-step-summary')
        .map((step) => step.textContent),
    ).toEqual(['管理者', '部門主管']);
    expect(within(cards[0]!).getByTestId('approval-flow-version')).toHaveTextContent('第 2 版');
  });

  it('沒有流程 → 寫明目前以單關審批運作，不是空白的欄位', async () => {
    renderRoute(routes, '/system/approval-flows', READER);
    const [, card] = await screen.findAllByTestId('approval-flow-card', undefined, {
      timeout: 5000,
    });
    if (!card) throw new Error('沒有第二張卡片');
    expect(within(card).getByTestId('approval-flow-mode')).toHaveTextContent(
      '申請由持有審批權限的人一次核准或駁回。',
    );
    expect(within(card).queryByTestId('approval-flow-steps')).toBeNull();
    expect(within(card).queryByTestId('approval-flow-version')).toBeNull();
  });

  it('只有 approvalFlow:read → 動作鈕是「檢視」；能修改 → 沒有流程的是「設定流程」、有流程的是「編輯流程」', async () => {
    const { unmount } = renderRoute(routes, '/system/approval-flows', READER);
    let buttons = await screen.findAllByTestId('approval-flow-open', undefined, { timeout: 5000 });
    expect(buttons.map((button) => button.textContent)).toEqual(['檢視', '檢視']);
    unmount();

    renderRoute(routes, '/system/approval-flows', [
      'approvalFlow:read',
      'approvalFlow:update',
    ] as PermissionKey[]);
    buttons = await screen.findAllByTestId('approval-flow-open', undefined, { timeout: 5000 });
    expect(buttons.map((button) => button.textContent)).toEqual(['編輯流程', '設定流程']);
    expect(buttons[1]).toHaveAttribute('href', '/system/approval-flows/future.type');
  });

  it('有關卡的規則目前不能用 → 卡片上標出警示', async () => {
    renderRoute(routes, '/system/approval-flows', READER);
    expect(
      await screen.findByTestId('approval-flow-assignee-issue', undefined, { timeout: 5000 }),
    ).toHaveTextContent('有審核者無法使用');
  });

  it('沒有支援流程的類型 → 說明，而不是空的表格', async () => {
    fetchList.mockResolvedValue({
      items: [],
      assigneeKinds: { user: true, group: true, role: true, manager: true, orgUnit: true },
    });
    renderRoute(routes, '/system/approval-flows', READER);
    expect(
      await screen.findByTestId('approval-flow-list-empty', undefined, { timeout: 5000 }),
    ).toHaveTextContent('目前沒有支援多階段流程的審批類型。');
  });

  it('卡片上一行實際運作；有找不到審核者的申請時標示，沒有任何申請時不顯示', async () => {
    fetchStats.mockImplementation(({ params }: { params: { type: string } }) =>
      Promise.resolve(
        params.type === 'user.register'
          ? {
              ...NO_STATS,
              submitted: 4,
              pending: 2,
              currentSteps: [{ name: '管理者', pending: 2, shortage: 1 }],
            }
          : NO_STATS,
      ),
    );
    renderRoute(routes, '/system/approval-flows', READER);
    const line = await screen.findByTestId('approval-flow-stats-line', undefined, {
      timeout: 5000,
    });
    expect(line).toHaveTextContent('近 30 天送出 4 筆，目前進行中 2 筆');
    expect(within(line).getByTestId('approval-flow-stats-line-shortage')).toHaveTextContent(
      '1 筆找不到審核者',
    );
    expect(screen.getAllByTestId('approval-flow-stats-line')).toHaveLength(1);
  });
});
