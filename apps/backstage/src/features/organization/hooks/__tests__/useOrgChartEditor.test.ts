import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgUnit } from '@/shared/api-sdk';

import { renameNode } from '../../pages/Organization/orgChart';
import type { OrgChartValue } from '../../pages/Organization/orgChart';
import { useOrgChartEditor } from '../useOrgChartEditor';

const api = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  move: vi.fn(),
  remove: vi.fn(),
  invalidateResources: vi.fn(),
}));
vi.mock('@/apis/org-unit/create-org-unit/fetcher', () => ({
  fetchOrgUnitCreateMutation: api.create,
}));
vi.mock('@/apis/org-unit/update-org-unit/fetcher', () => ({
  fetchOrgUnitUpdateMutation: api.update,
}));
vi.mock('@/apis/org-unit/move-org-unit/fetcher', () => ({ fetchOrgUnitMoveMutation: api.move }));
vi.mock('@/apis/org-unit/delete-org-unit/fetcher', () => ({
  fetchOrgUnitDeleteMutation: api.remove,
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

const unit = (id: string, name: string, parentId: string | null, version = 3): OrgUnit => ({
  id,
  parentId,
  name,
  code: null,
  description: null,
  sortOrder: 0,
  memberCount: 0,
  managerCount: 0,
  managers: [],
  version,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

// hq ─┬─ sales
//     └─ rd
const UNITS = [
  unit('hq', '總公司', null),
  unit('sales', '業務部', 'hq'),
  unit('rd', '研發部', 'hq'),
];
// 編輯期間別人新增了「新專案組」、把業務部改名為「業務一部」
const LATEST = [
  unit('hq', '總公司', null),
  unit('sales', '業務一部', 'hq', 4),
  unit('rd', '研發部', 'hq'),
  unit('project', '新專案組', 'hq'),
];

const removeNode = (value: OrgChartValue, id: string): OrgChartValue => ({
  nodes: value.nodes.filter((node) => node.id !== id),
  edges: value.edges.filter((edge) => edge.source !== id && edge.target !== id),
});

function renderEditor() {
  return renderHook(({ units }) => useOrgChartEditor(units), {
    initialProps: { units: UNITS as readonly OrgUnit[] },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.update.mockImplementation(async ({ params }) => ({ version: params.body.version + 1 }));
  api.remove.mockResolvedValue(undefined);
});

describe('useOrgChartEditor（組織圖的編輯模式）', () => {
  it('編輯期間部門樹被別人改過：不算成自己的變更，提示 outdated', () => {
    const { result, rerender } = renderEditor();
    act(() => result.current.start());
    rerender({ units: LATEST });

    expect(result.current.changeCount).toBe(0);
    expect(result.current.isDirty).toBe(false);
    expect(result.current.outdated).toBe(true);
    // 草稿不被換掉：畫布仍是進入編輯時的樹
    expect(result.current.value.nodes.map((node) => node.id).toSorted()).toEqual([
      'hq',
      'rd',
      'sales',
    ]);
  });

  it('儲存只送出自己的改名，version 是進入編輯時的版本（別人改過就由後端回 409）', async () => {
    const { result, rerender } = renderEditor();
    act(() => result.current.start());
    rerender({ units: LATEST });
    act(() => result.current.setDraft(renameNode(result.current.value, 'sales', '業務本部')));
    expect(result.current.changeCount).toBe(1);

    await act(() => result.current.save());

    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.update).toHaveBeenCalledWith({
      params: { unitId: 'sales', body: { name: '業務本部', version: 3 } },
    });
    expect(api.remove).not.toHaveBeenCalled();
    expect(result.current.editing).toBe(false);
  });

  it('要刪除的部門被別人改過：什麼都不送出，留在編輯模式並列出部門', async () => {
    const { result, rerender } = renderEditor();
    act(() => result.current.start());
    act(() => result.current.setDraft(removeNode(result.current.value, 'sales')));
    rerender({ units: LATEST });

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.save();
    });

    expect(saved).toBe(false);
    expect(api.remove).not.toHaveBeenCalled();
    expect(api.invalidateResources).not.toHaveBeenCalled();
    expect(result.current.editing).toBe(true);
    expect(result.current.deleteConflicts).toEqual(['業務部']);

    // 重新開始：以最新的樹為準，提示消失
    act(() => result.current.start());
    expect(result.current.outdated).toBe(false);
    expect(result.current.deleteConflicts).toEqual([]);
    expect(result.current.value.nodes).toHaveLength(4);
  });

  it('要刪除的部門沒被動過：照常刪除', async () => {
    const { result, rerender } = renderEditor();
    act(() => result.current.start());
    act(() => result.current.setDraft(removeNode(result.current.value, 'rd')));
    rerender({ units: LATEST });

    await act(() => result.current.save());

    expect(api.remove).toHaveBeenCalledWith({ params: { unitId: 'rd' } });
    expect(result.current.deleteConflicts).toEqual([]);
  });
});
