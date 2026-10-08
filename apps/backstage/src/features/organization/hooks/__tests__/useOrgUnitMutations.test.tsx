import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore, resetFeatureStore } from '@/core/feature';
import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import {
  useOrgUnitCreateMutation,
  useOrgUnitDeleteMutation,
  useOrgUnitMembersUpdateMutation,
  useOrgUnitMoveMutation,
  useOrgUnitRestoreMutation,
  useOrgUnitUpdateMutation,
} from '../useOrgUnitMutations';

const api = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  move: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  members: vi.fn(),
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
vi.mock('@/apis/org-unit/restore-org-unit/fetcher', () => ({
  fetchOrgUnitRestoreMutation: api.restore,
}));
vi.mock('@/apis/org-unit/update-org-unit-members/fetcher', () => ({
  fetchOrgUnitMembersUpdateMutation: api.members,
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

const UNIT = { id: 'o1', name: '業務部' };
const UNIT_UPDATED = [{ resource: 'orgUnit', kind: 'update', id: 'o1' }];
const CONFLICT = new AppError('ORG_UNIT_VERSION_CONFLICT', 409);
const CONFLICT_MESSAGE = '部門已被他人修改，請重新載入後再儲存。';
const FORBIDDEN = new AppError('AUTHZ_FORBIDDEN', 403);
const FORBIDDEN_MESSAGE = '你沒有執行這個操作的權限。';

function render<T>(hook: () => T) {
  return renderHook(hook, { wrapper: AllProviders }).result;
}

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
  resetFeatureStore();
  featureStore.setState({ resolved: true, statuses: new Map([['trash', 'ready']]) });
});

describe('useOrgUnitCreateMutation', () => {
  it('新增成功 → 宣告 orgUnit create 並提示名稱', async () => {
    api.create.mockResolvedValue(UNIT);
    const result = render(() => useOrgUnitCreateMutation());
    act(() => result.current.mutate({ params: {} as never }));
    expect(await screen.findByText('已新增部門「業務部」')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'orgUnit', kind: 'create', id: 'o1' },
    ]);
  });
});

describe('useOrgUnitUpdateMutation', () => {
  it('更新成功 → 宣告 orgUnit update 並提示', async () => {
    api.update.mockResolvedValue(UNIT);
    const result = render(() => useOrgUnitUpdateMutation());
    act(() => result.current.mutate({ params: { unitId: 'o1' } as never }));
    expect(await screen.findByText('已更新部門')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith(UNIT_UPDATED);
  });

  it('版本衝突 → 失效該部門，不彈 toast（訊息交給表單）', async () => {
    api.update.mockRejectedValue(CONFLICT);
    const result = render(() => useOrgUnitUpdateMutation());
    act(() => result.current.mutate({ params: { unitId: 'o1' } as never }));
    await waitFor(() => expect(api.invalidateResources).toHaveBeenCalledWith(UNIT_UPDATED));
    expect(screen.queryByText(CONFLICT_MESSAGE)).not.toBeInTheDocument();
  });

  it('其他錯誤 → 以 toast 顯示、不失效', async () => {
    api.update.mockRejectedValue(FORBIDDEN);
    const result = render(() => useOrgUnitUpdateMutation());
    act(() => result.current.mutate({ params: { unitId: 'o1' } as never }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});

describe('useOrgUnitMoveMutation', () => {
  it('搬移成功 → 宣告 orgUnit update 並提示名稱', async () => {
    api.move.mockResolvedValue(UNIT);
    const result = render(() => useOrgUnitMoveMutation());
    act(() => result.current.mutate({ params: { unitId: 'o1' } as never }));
    expect(await screen.findByText('已搬移部門「業務部」')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith(UNIT_UPDATED);
  });

  it('版本衝突 → 失效該部門讓重試帶對的 version，並顯示錯誤', async () => {
    api.move.mockRejectedValue(CONFLICT);
    const result = render(() => useOrgUnitMoveMutation());
    act(() => result.current.mutate({ params: { unitId: 'o1' } as never }));
    expect(await screen.findByText(CONFLICT_MESSAGE)).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith(UNIT_UPDATED);
  });

  it('其他錯誤（循環、超過層數）→ 只顯示錯誤、不失效', async () => {
    api.move.mockRejectedValue(FORBIDDEN);
    const result = render(() => useOrgUnitMoveMutation());
    act(() => result.current.mutate({ params: { unitId: 'o1' } as never }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});

describe('useOrgUnitDeleteMutation', () => {
  it('刪除成功 → 宣告 orgUnit delete，提示的「復原」按下就還原', async () => {
    api.remove.mockResolvedValue(undefined);
    api.restore.mockResolvedValue(UNIT);
    const result = render(() => useOrgUnitDeleteMutation());
    act(() => result.current.mutate({ params: { unitId: 'o1' } }));
    expect(await screen.findByText('已刪除部門')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'orgUnit', kind: 'delete', id: 'o1' },
    ]);

    fireEvent.click(screen.getByRole('button', { name: '復原' }));
    await waitFor(() => expect(api.restore).toHaveBeenCalledTimes(1));
    expect(api.restore.mock.calls[0]![0].params).toEqual({ unitId: 'o1' });
  });

  it('租戶沒有啟用回收桶 → 提示沒有「復原」', async () => {
    featureStore.setState({ statuses: new Map() });
    api.remove.mockResolvedValue(undefined);
    const result = render(() => useOrgUnitDeleteMutation());
    act(() => result.current.mutate({ params: { unitId: 'o1' } }));
    expect(await screen.findByText('已刪除部門')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '復原' })).not.toBeInTheDocument();
  });

  it('還有下層部門（409）→ 以 toast 顯示原因', async () => {
    api.remove.mockRejectedValue(new AppError('ORG_UNIT_HAS_CHILDREN', 409));
    const result = render(() => useOrgUnitDeleteMutation());
    act(() => result.current.mutate({ params: { unitId: 'o1' } }));
    expect(await screen.findByText('還有下層部門，請先刪除或搬走下層部門。')).toBeInTheDocument();
  });
});

describe('useOrgUnitRestoreMutation', () => {
  it('還原成功 → 以 orgUnit create 宣告並提示名稱', async () => {
    api.restore.mockResolvedValue(UNIT);
    const result = render(() => useOrgUnitRestoreMutation());
    act(() => result.current.mutate({ params: { unitId: 'o1' } }));
    expect(await screen.findByText('已還原部門「業務部」，成員一併恢復')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'orgUnit', kind: 'create', id: 'o1' },
    ]);
  });

  it('失敗 → 以 toast 顯示錯誤', async () => {
    api.restore.mockRejectedValue(FORBIDDEN);
    const result = render(() => useOrgUnitRestoreMutation());
    act(() => result.current.mutate({ params: { unitId: 'o1' } }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});

describe('useOrgUnitMembersUpdateMutation', () => {
  it('成功 → 宣告 orgUnit update 並提示', async () => {
    api.members.mockResolvedValue(UNIT);
    const result = render(() => useOrgUnitMembersUpdateMutation());
    act(() => result.current.mutate({ params: { unitId: 'o1' } as never }));
    expect(await screen.findByText('已更新部門的成員')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith(UNIT_UPDATED);
  });

  it('不能改自己（403）→ 以 toast 顯示錯誤', async () => {
    api.members.mockRejectedValue(FORBIDDEN);
    const result = render(() => useOrgUnitMembersUpdateMutation());
    act(() => result.current.mutate({ params: { unitId: 'o1' } as never }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});
