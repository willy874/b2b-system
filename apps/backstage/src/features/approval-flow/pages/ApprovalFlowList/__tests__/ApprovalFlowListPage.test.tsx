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

const { fetchList } = vi.hoisted(() => ({ fetchList: vi.fn() }));
vi.mock('@/apis/approval-flow/get-approval-flow-list/fetcher', () => ({
  fetchApprovalFlowListQuery: fetchList,
}));

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
    fields: [{ key: 'emailDomain', type: 'string', options: null }],
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
  { type: 'future.type', requester: 'user', fields: [], flow: null },
];

const READER = ['approvalFlow:read'] as PermissionKey[];
const routes = [Routes.ApprovalFlowListRoute];

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerApprovalFlowPagePermissions();
  fetchList.mockReset().mockResolvedValue({
    items: ITEMS,
    assigneeKinds: { user: true, group: true, role: true, manager: false, orgUnit: false },
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('審批流程列表的頁面權限（docs/architecture/backend/20-approval.md §9.14）', () => {
  it('有 approvalFlow:read → 進得去', () => {
    usePermissionStore.setState({ permissions: new Set(READER), hydrated: true });
    expect(renderHook(() => usePageAccess('/approval-flow')).result.current).toMatchObject({
      gated: true,
      canAccess: true,
    });
    // 編輯頁以路徑前綴沿用同一個頁面權限
    expect(
      renderHook(() => usePageAccess('/approval-flow/user.register')).result.current,
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
    expect(renderHook(() => usePageAccess('/approval-flow')).result.current).toMatchObject({
      gated: true,
      canAccess: false,
    });
  });

  it('權限未水合 → 還不能判斷（不閃現內容，也不閃 403）', () => {
    usePermissionStore.setState({ permissions: new Set(), hydrated: false });
    expect(renderHook(() => usePageAccess('/approval-flow')).result.current).toMatchObject({
      hydrated: false,
      gated: true,
    });
  });
});

describe('ApprovalFlowListPage（docs/architecture/backend/20-approval.md §9.16）', () => {
  it('每一列：類型名稱（不認得的顯示原字串）、流程狀態、關卡摘要、版本', async () => {
    renderRoute(routes, '/approval-flow', READER);
    const table = await screen.findByTestId('approval-flow-table', undefined, { timeout: 5000 });
    const links = await within(table).findAllByTestId('approval-flow-type-link');
    expect(links.map((link) => link.textContent)).toEqual(['使用者註冊', 'future.type']);

    const statuses = within(table).getAllByTestId('approval-flow-status');
    expect(statuses.map((status) => status.getAttribute('data-value'))).toEqual([
      'enabled',
      'unset',
    ]);
    expect(statuses.map((status) => status.textContent)).toEqual(['啟用中', '未設定']);
    expect(within(table).getByTestId('approval-flow-steps')).toHaveTextContent('管理者 → 部門主管');
  });

  it('有關卡的規則目前不能用 → 列上標出警示', async () => {
    renderRoute(routes, '/approval-flow', READER);
    expect(
      await screen.findByTestId('approval-flow-assignee-issue', undefined, { timeout: 5000 }),
    ).toHaveTextContent('有審核者無法使用');
  });
});
