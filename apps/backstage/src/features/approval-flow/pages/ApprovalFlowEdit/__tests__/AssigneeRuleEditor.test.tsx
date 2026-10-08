import { AllProviders } from '@b2b-system/web-core/testing';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import type { AssigneeDraft } from '../../../hooks/flowDraft';
import type { AssigneeKindAvailability } from '../../../hooks/useAssigneeKindAvailability';
import approvalFlowZhTW from '../../../locales/zh_TW.json';
import { AssigneeRuleEditor } from '../components/AssigneeRuleEditor';
import type { AssigneeListAccess } from '../components/AssigneeRuleEditor';

const { fetchUsers, fetchGroups, fetchRoles, fetchTree } = vi.hoisted(() => ({
  fetchUsers: vi.fn(),
  fetchGroups: vi.fn(),
  fetchRoles: vi.fn(),
  fetchTree: vi.fn(),
}));
vi.mock('@/apis/user/get-user-list/fetcher', () => ({ fetchUserListQuery: fetchUsers }));
vi.mock('@/apis/group/get-group-list/fetcher', () => ({ fetchGroupListQuery: fetchGroups }));
vi.mock('@/apis/role/get-role-list/fetcher', () => ({ fetchRoleListQuery: fetchRoles }));
vi.mock('@/apis/org-unit/get-org-unit-tree/fetcher', () => ({ fetchOrgUnitTreeQuery: fetchTree }));

const AVAILABLE: AssigneeKindAvailability = {
  user: undefined,
  group: undefined,
  role: undefined,
  manager: undefined,
  orgUnit: undefined,
};
const FULL_ACCESS: AssigneeListAccess = {
  canSearchUsers: true,
  canListGroups: true,
  canListRoles: true,
  canListOrgUnits: true,
};
const orgUnit = (id: string, name: string, parentId: string | null) => ({ id, name, parentId });

function renderEditor(
  initial: AssigneeDraft,
  props: Partial<{
    isAnonymous: boolean;
    availability: AssigneeKindAvailability;
    access: AssigneeListAccess;
    savedStatus: { label: string; available: boolean; deleted: boolean };
  }> = {},
) {
  const onChange = vi.fn();
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <AssigneeRuleEditor
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        isAnonymous={props.isAnonymous ?? false}
        availability={props.availability ?? AVAILABLE}
        access={props.access ?? FULL_ACCESS}
        savedStatus={props.savedStatus as never}
        invalid={false}
      />
    );
  }
  render(<Harness />, { wrapper: AllProviders });
  return onChange;
}

const lastChange = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.lastCall?.[0];

async function openOptions(name: string) {
  fireEvent.click(screen.getByRole('combobox', { name }));
  await screen.findByRole('listbox');
  return screen.getAllByRole('option').map((option) => option.textContent);
}

beforeAll(() => initTestI18n(approvalFlowZhTW));

const list = (items: unknown[]) => ({ items, pagination: { total: items.length } });

beforeEach(() => {
  fetchUsers.mockReset().mockResolvedValue(list([]));
  fetchGroups.mockReset().mockResolvedValue(list([{ id: 'g1', name: '美術' }]));
  fetchRoles.mockReset().mockResolvedValue(list([{ id: 'r1', name: '編輯者' }]));
  fetchTree.mockReset().mockResolvedValue({
    items: [
      orgUnit('u-sales', '業務部', 'u-hq'),
      orgUnit('u-hq', '總公司', null),
      orgUnit('u-north', '北區', 'u-sales'),
    ],
  });
});

describe('AssigneeRuleEditor（審核者規則，docs/architecture/backend/20-approval.md §10.2 D14）', () => {
  it('換種類會清掉對象、保留主管層級', async () => {
    const onChange = renderEditor({ kind: 'user', targetId: 'u1', level: 2 });
    await openOptions('審核者的種類');
    fireEvent.click(screen.getByRole('option', { name: /^群組/ }));
    expect(lastChange(onChange)).toEqual({ kind: 'group', targetId: null, level: 2 });
  });

  it('不能用的種類停用並說明原因；已選的種類即使不能用也保留可選並標出警示', async () => {
    renderEditor(
      { kind: 'group', targetId: 'g1', level: 1 },
      {
        availability: {
          ...AVAILABLE,
          group: 'approvalFlow.assignee.unavailable.group',
          orgUnit: 'approvalFlow.assignee.unavailable.organization',
        },
      },
    );
    expect(screen.getByTestId('approval-flow-assignee-unavailable')).toHaveTextContent(
      '群組未啟用',
    );
    // 群組未啟用：不載入群組清單
    expect(fetchGroups).not.toHaveBeenCalled();

    await openOptions('審核者的種類');
    expect(screen.getByRole('option', { name: /部門的主管/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('option', { name: /^群組/ })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('匿名申請不提供「主管」；已經是主管規則時仍保留', async () => {
    renderEditor({ kind: 'user', targetId: null, level: 1 }, { isAnonymous: true });
    expect(await openOptions('審核者的種類')).not.toContainEqual(
      expect.stringContaining('申請人的主管'),
    );
  });

  it('主管：選第幾層', async () => {
    const onChange = renderEditor(
      { kind: 'manager', targetId: null, level: 1 },
      { isAnonymous: true },
    );
    await openOptions('主管層級');
    fireEvent.click(screen.getByRole('option', { name: '申請人的第 3 層主管' }));
    expect(lastChange(onChange)).toEqual({ kind: 'manager', targetId: null, level: 3 });
  });

  it('群組：從清單選對象', async () => {
    const onChange = renderEditor({ kind: 'group', targetId: null, level: 1 });
    await waitFor(() => expect(fetchGroups).toHaveBeenCalled());
    await openOptions('審核者');
    fireEvent.click(await screen.findByRole('option', { name: '美術' }));
    expect(lastChange(onChange)).toEqual({ kind: 'group', targetId: 'g1', level: 1 });
  });

  it('角色：讀不到角色清單時停用，只以已儲存的名稱顯示目前的值', async () => {
    renderEditor(
      { kind: 'role', targetId: 'r9', level: 1 },
      {
        access: { ...FULL_ACCESS, canListRoles: false },
        savedStatus: { label: '舊角色', available: true, deleted: true },
      },
    );
    const select = screen.getByRole('combobox', { name: '審核者' });
    expect(select).toHaveTextContent('舊角色');
    expect(select).toBeDisabled();
    expect(fetchRoles).not.toHaveBeenCalled();
    expect(screen.getByTestId('approval-flow-assignee-deleted')).toHaveTextContent('已刪除');
  });

  it('角色：從清單選對象', async () => {
    const onChange = renderEditor({ kind: 'role', targetId: null, level: 1 });
    await waitFor(() => expect(fetchRoles).toHaveBeenCalled());
    await openOptions('審核者');
    fireEvent.click(await screen.findByRole('option', { name: '編輯者' }));
    expect(lastChange(onChange)).toMatchObject({ kind: 'role', targetId: 'r1' });
  });

  it('部門：以完整路徑排序顯示', async () => {
    const onChange = renderEditor({ kind: 'orgUnit', targetId: null, level: 1 });
    await waitFor(() => expect(fetchTree).toHaveBeenCalled());
    await waitFor(async () =>
      expect(await openOptions('審核者')).toEqual([
        '總公司',
        '總公司 / 業務部',
        '總公司 / 業務部 / 北區',
      ]),
    );
    fireEvent.click(screen.getByRole('option', { name: '總公司 / 業務部 / 北區' }));
    expect(lastChange(onChange)).toMatchObject({ kind: 'orgUnit', targetId: 'u-north' });
  });

  it('已儲存的規則變成不能用（功能被關掉）→ 標示功能未啟用', () => {
    renderEditor(
      { kind: 'orgUnit', targetId: 'u-x', level: 1 },
      {
        access: { ...FULL_ACCESS, canListOrgUnits: false },
        savedStatus: { label: '舊部門', available: false, deleted: false },
      },
    );
    expect(screen.getByTestId('approval-flow-assignee-unavailable')).toHaveTextContent(
      '功能未啟用',
    );
    expect(screen.queryByTestId('approval-flow-assignee-deleted')).toBeNull();
    expect(fetchTree).not.toHaveBeenCalled();
  });

  it('使用者：沒有搜尋使用者的權限時停用', () => {
    renderEditor(
      { kind: 'user', targetId: null, level: 1 },
      { access: { ...FULL_ACCESS, canSearchUsers: false } },
    );
    expect(screen.getByRole('combobox', { name: '審核者' })).toBeDisabled();
    expect(screen.queryByTestId('approval-flow-assignee-unavailable')).toBeNull();
  });
});
