import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore, resetFeatureStore } from '@/core/feature';
import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import { DEFAULT_GROUP_SEARCH, GroupDetailRoute } from '../../routes';
import {
  useGroupCreateMutation,
  useGroupDeleteMutation,
  useGroupMembersUpdateMutation,
  useGroupRestoreMutation,
  useGroupRolesUpdateMutation,
  useGroupUpdateMutation,
} from '../useGroupMutations';

const api = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  members: vi.fn(),
  roles: vi.fn(),
  invalidateResources: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@/apis/group/create-group/fetcher', () => ({ fetchGroupCreateMutation: api.create }));
vi.mock('@/apis/group/update-group/fetcher', () => ({ fetchGroupUpdateMutation: api.update }));
vi.mock('@/apis/group/delete-group/fetcher', () => ({ fetchGroupDeleteMutation: api.remove }));
vi.mock('@/apis/group/restore-group/fetcher', () => ({ fetchGroupRestoreMutation: api.restore }));
vi.mock('@/apis/group/update-group-members/fetcher', () => ({
  fetchGroupMembersUpdateMutation: api.members,
}));
vi.mock('@/apis/group/update-group-roles/fetcher', () => ({
  fetchGroupRolesUpdateMutation: api.roles,
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => api.navigate,
}));

const GROUP = { id: 'g1', name: '研發部', version: 2 };
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

describe('useGroupCreateMutation', () => {
  it('建立成功 → 宣告 group create 並提示名稱', async () => {
    api.create.mockResolvedValue(GROUP);
    const result = render(() => useGroupCreateMutation());
    act(() => result.current.mutate({ params: { name: '研發部' } as never }));
    expect(await screen.findByText('已建立群組「研發部」')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'group', kind: 'create', id: 'g1' },
    ]);
  });
});

describe('useGroupUpdateMutation', () => {
  it('更新成功 → 宣告 group update 並提示', async () => {
    api.update.mockResolvedValue(GROUP);
    const result = render(() => useGroupUpdateMutation());
    act(() => result.current.mutate({ params: { groupId: 'g1' } as never }));
    expect(await screen.findByText('已更新群組')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'group', kind: 'update', id: 'g1' },
    ]);
  });

  it('版本衝突 → 失效該群組讓畫面拿到最新版本，不彈 toast', async () => {
    api.update.mockRejectedValue(new AppError('GROUP_VERSION_CONFLICT', 409));
    const result = render(() => useGroupUpdateMutation());
    act(() => result.current.mutate({ params: { groupId: 'g1' } as never }));
    await waitFor(() =>
      expect(api.invalidateResources).toHaveBeenCalledWith([
        { resource: 'group', kind: 'update', id: 'g1' },
      ]),
    );
    expect(result.current.isError).toBe(true);
    expect(
      screen.queryByText('這個群組已經被其他人修改，請重新載入後再編輯。'),
    ).not.toBeInTheDocument();
  });

  it('其他錯誤 → 以 toast 顯示錯誤訊息、不失效', async () => {
    api.update.mockRejectedValue(FORBIDDEN);
    const result = render(() => useGroupUpdateMutation());
    act(() => result.current.mutate({ params: { groupId: 'g1' } as never }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});

describe('useGroupDeleteMutation', () => {
  it('刪除成功 → 宣告 group delete，提示的「復原」按下就還原該群組', async () => {
    api.remove.mockResolvedValue(undefined);
    api.restore.mockResolvedValue(GROUP);
    const result = render(() => useGroupDeleteMutation());
    act(() => result.current.mutate({ params: { groupId: 'g1' } }));
    expect(await screen.findByText('已刪除群組')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'group', kind: 'delete', id: 'g1' },
    ]);

    fireEvent.click(screen.getByRole('button', { name: '復原' }));
    await waitFor(() => expect(api.restore).toHaveBeenCalledTimes(1));
    expect(api.restore.mock.calls[0]![0].params).toEqual({ groupId: 'g1' });
  });

  it('租戶沒有啟用回收桶 → 提示沒有「復原」', async () => {
    featureStore.setState({ statuses: new Map([['trash', 'disabled']]) });
    api.remove.mockResolvedValue(undefined);
    const result = render(() => useGroupDeleteMutation());
    act(() => result.current.mutate({ params: { groupId: 'g1' } }));
    expect(await screen.findByText('已刪除群組')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '復原' })).not.toBeInTheDocument();
  });

  it('刪除失敗 → 以 toast 顯示錯誤', async () => {
    api.remove.mockRejectedValue(FORBIDDEN);
    const result = render(() => useGroupDeleteMutation());
    act(() => result.current.mutate({ params: { groupId: 'g1' } }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});

describe('useGroupRestoreMutation', () => {
  it('還原成功 → 以 group create 宣告並提示名稱', async () => {
    api.restore.mockResolvedValue(GROUP);
    const result = render(() => useGroupRestoreMutation());
    act(() => result.current.mutate({ params: { groupId: 'g1' } }));
    expect(await screen.findByText('已還原群組「研發部」，成員與角色一併恢復')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'group', kind: 'create', id: 'g1' },
    ]);
  });

  it('名稱被佔用 → 提示附「查看該群組」，按下導向佔用的群組', async () => {
    api.restore.mockRejectedValue(
      new AppError('GROUP_NAME_DUPLICATE', 409, { conflictingGroupId: 'g9' }),
    );
    const result = render(() => useGroupRestoreMutation());
    act(() => result.current.mutate({ params: { groupId: 'g1' } }));
    expect(await screen.findByText('已有同名的群組（名稱不分大小寫）。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看該群組' }));
    expect(api.navigate).toHaveBeenCalledWith({
      to: GroupDetailRoute.to,
      params: { groupId: 'g9' },
      search: DEFAULT_GROUP_SEARCH,
    });
  });

  it('conflictingGroupId 不是字串 → 當一般錯誤顯示，沒有連結', async () => {
    api.restore.mockRejectedValue(
      new AppError('GROUP_NAME_DUPLICATE', 409, { conflictingGroupId: 42 }),
    );
    const result = render(() => useGroupRestoreMutation());
    act(() => result.current.mutate({ params: { groupId: 'g1' } }));
    expect(await screen.findByText('已有同名的群組（名稱不分大小寫）。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看該群組' })).not.toBeInTheDocument();
  });

  it('非 AppError 的錯誤 → 顯示通用錯誤訊息', async () => {
    api.restore.mockRejectedValue(new Error('boom'));
    const result = render(() => useGroupRestoreMutation());
    act(() => result.current.mutate({ params: { groupId: 'g1' } }));
    expect(await screen.findByText('發生未預期的錯誤，請稍後再試。')).toBeInTheDocument();
  });
});

describe('useGroupMembersUpdateMutation', () => {
  it('成功 → 宣告 group update 並提示', async () => {
    api.members.mockResolvedValue(GROUP);
    const result = render(() => useGroupMembersUpdateMutation());
    act(() => result.current.mutate({ params: { groupId: 'g1' } as never }));
    expect(await screen.findByText('已更新群組的成員')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'group', kind: 'update', id: 'g1' },
    ]);
  });

  it('失敗 → 以 toast 顯示錯誤', async () => {
    api.members.mockRejectedValue(FORBIDDEN);
    const result = render(() => useGroupMembersUpdateMutation());
    act(() => result.current.mutate({ params: { groupId: 'g1' } as never }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});

describe('useGroupRolesUpdateMutation', () => {
  it('成功 → 以參數的 groupId 宣告 group update 並提示', async () => {
    api.roles.mockResolvedValue(undefined);
    const result = render(() => useGroupRolesUpdateMutation());
    act(() => result.current.mutate({ params: { groupId: 'g1' } as never }));
    expect(await screen.findByText('已更新群組的角色')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'group', kind: 'update', id: 'g1' },
    ]);
  });

  it('失敗 → 以 toast 顯示錯誤', async () => {
    api.roles.mockRejectedValue(FORBIDDEN);
    const result = render(() => useGroupRolesUpdateMutation());
    act(() => result.current.mutate({ params: { groupId: 'g1' } as never }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});
