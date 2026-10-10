import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore, resetFeatureStore } from '@/core/feature';
import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import { UserDetailRoute } from '../../routes';
import {
  roleRefs,
  useAssignUserRolesMutation,
  useUserCreateMutation,
  useUserDeleteMutation,
  useUserResetPasswordMutation,
  useUserRestoreMutation,
  useUserTagsReplaceMutation,
  useUserUnlockMutation,
  useUserUpdateMutation,
} from '../useUserMutations';

const api = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  assign: vi.fn(),
  unlock: vi.fn(),
  resetPassword: vi.fn(),
  tags: vi.fn(),
  invalidateResources: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@/apis/user/create-user/fetcher', () => ({ fetchUserCreateMutation: api.create }));
vi.mock('@/apis/user/update-user/fetcher', () => ({ fetchUserUpdateMutation: api.update }));
vi.mock('@/apis/user/delete-user/fetcher', () => ({ fetchUserDeleteMutation: api.remove }));
vi.mock('@/apis/user/restore-user/fetcher', () => ({ fetchUserRestoreMutation: api.restore }));
vi.mock('@/apis/user/assign-user-roles/fetcher', () => ({
  fetchAssignUserRolesMutation: api.assign,
}));
vi.mock('@/apis/user/unlock-user/fetcher', () => ({ fetchUserUnlockMutation: api.unlock }));
vi.mock('@/apis/user/reset-user-password/fetcher', () => ({
  fetchUserResetPasswordMutation: api.resetPassword,
}));
vi.mock('@/apis/tag/replace-resource-tags/fetcher', () => ({
  fetchResourceTagsReplaceMutation: api.tags,
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => api.navigate,
}));

const USER = {
  id: 'u1',
  email: 'amy@example.com',
  displayName: 'Amy',
  roles: [{ id: 'r1' }, { id: 'r2' }],
};
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

describe('roleRefs', () => {
  it('取出使用者持有的角色 id，讓依賴圖只失效這幾個角色', () => {
    expect(roleRefs(USER as never)).toEqual({ role: ['r1', 'r2'] });
  });
});

describe('useUserCreateMutation', () => {
  it('建立成功 → 宣告 user create（refs 帶角色）並提示 email', async () => {
    api.create.mockResolvedValue(USER);
    const result = render(() => useUserCreateMutation());
    act(() => result.current.mutate({ params: {} as never }));
    expect(await screen.findByText('已建立使用者 amy@example.com。')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'user', kind: 'create', refs: { role: ['r1', 'r2'] } },
    ]);
  });
});

describe('useUserUpdateMutation', () => {
  it('更新成功 → 宣告 user update（refs 帶角色）並提示', async () => {
    api.update.mockResolvedValue(USER);
    const result = render(() => useUserUpdateMutation());
    act(() => result.current.mutate({ params: { userId: 'u1' } as never }));
    expect(await screen.findByText('使用者已更新。')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'user', kind: 'update', id: 'u1', refs: { role: ['r1', 'r2'] } },
    ]);
  });

  it('版本衝突 → 失效該使用者，不彈 toast', async () => {
    api.update.mockRejectedValue(new AppError('USER_VERSION_CONFLICT', 409));
    const result = render(() => useUserUpdateMutation());
    act(() => result.current.mutate({ params: { userId: 'u1' } as never }));
    await waitFor(() =>
      expect(api.invalidateResources).toHaveBeenCalledWith([
        { resource: 'user', kind: 'update', id: 'u1' },
      ]),
    );
    expect(
      screen.queryByText('這位使用者的資料已經被其他人修改，請重新載入後再編輯。'),
    ).not.toBeInTheDocument();
  });

  it('其他錯誤 → 以 toast 顯示、不失效', async () => {
    api.update.mockRejectedValue(FORBIDDEN);
    const result = render(() => useUserUpdateMutation());
    act(() => result.current.mutate({ params: { userId: 'u1' } as never }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});

describe('useUserDeleteMutation', () => {
  it('租戶沒有啟用回收桶 → 提示沒有「復原」', async () => {
    featureStore.setState({ statuses: new Map() });
    api.remove.mockResolvedValue(undefined);
    const result = render(() => useUserDeleteMutation());
    act(() => result.current.mutate({ params: { userId: 'u1' } }));
    expect(await screen.findByText('使用者已刪除。')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'user', kind: 'delete', id: 'u1' },
    ]);
    expect(screen.queryByRole('button', { name: '復原' })).not.toBeInTheDocument();
  });

  it('刪除失敗 → 以 toast 顯示錯誤', async () => {
    api.remove.mockRejectedValue(FORBIDDEN);
    const result = render(() => useUserDeleteMutation());
    act(() => result.current.mutate({ params: { userId: 'u1' } }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});

describe('useUserRestoreMutation', () => {
  it('還原成功 → 以 user create 宣告（refs 帶角色）並提示名稱', async () => {
    api.restore.mockResolvedValue(USER);
    const result = render(() => useUserRestoreMutation());
    act(() => result.current.mutate({ params: { userId: 'u1' } }));
    expect(await screen.findByText('已還原「Amy」。')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'user', kind: 'create', id: 'u1', refs: { role: ['r1', 'r2'] } },
    ]);
  });

  it('email 被佔用 → 「查看該帳號」導向佔用的使用者', async () => {
    api.restore.mockRejectedValue(
      new AppError('USER_EMAIL_DUPLICATE', 409, { conflictingUserId: 'u9' }),
    );
    const result = render(() => useUserRestoreMutation());
    act(() => result.current.mutate({ params: { userId: 'u1' } }));
    expect(await screen.findByText('這個 Email 已被使用。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看該帳號' }));
    expect(api.navigate).toHaveBeenCalledWith({
      to: UserDetailRoute.to,
      params: { userId: 'u9' },
    });
  });

  it('沒有佔用的帳號 → 一般錯誤 toast，沒有連結', async () => {
    api.restore.mockRejectedValue(FORBIDDEN);
    const result = render(() => useUserRestoreMutation());
    act(() => result.current.mutate({ params: { userId: 'u1' } }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看該帳號' })).not.toBeInTheDocument();
  });
});

describe('useAssignUserRolesMutation', () => {
  it('成功 → 宣告 userRole update，refs 含新舊角色（去重）並提示', async () => {
    api.assign.mockResolvedValue(undefined);
    const result = render(() => useAssignUserRolesMutation(USER as never));
    act(() =>
      result.current.mutate({
        params: { userId: 'u1', body: { roleIds: ['r2', 'r3'], expectedRoleIds: ['r1', 'r2'] } },
      }),
    );
    expect(await screen.findByText('角色指派已更新。')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'userRole', kind: 'update', id: 'u1', refs: { role: ['r1', 'r2', 'r3'] } },
    ]);
  });

  it('失敗 → 以 toast 顯示錯誤', async () => {
    api.assign.mockRejectedValue(FORBIDDEN);
    const result = render(() => useAssignUserRolesMutation(USER as never));
    act(() =>
      result.current.mutate({
        params: { userId: 'u1', body: { roleIds: [], expectedRoleIds: [] } },
      }),
    );
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});

describe('useUserUnlockMutation', () => {
  it('解鎖成功 → 宣告 user update 並提示', async () => {
    api.unlock.mockResolvedValue(USER);
    const result = render(() => useUserUnlockMutation());
    act(() => result.current.mutate({ params: { userId: 'u1' } as never }));
    expect(await screen.findByText('帳號已解鎖。')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'user', kind: 'update', id: 'u1', refs: { role: ['r1', 'r2'] } },
    ]);
  });

  it('失敗 → 以 toast 顯示錯誤', async () => {
    api.unlock.mockRejectedValue(FORBIDDEN);
    const result = render(() => useUserUnlockMutation());
    act(() => result.current.mutate({ params: { userId: 'u1' } as never }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});

describe('useUserResetPasswordMutation', () => {
  it('成功 → 宣告 userCredential update 並提示已寄出', async () => {
    api.resetPassword.mockResolvedValue(undefined);
    const result = render(() => useUserResetPasswordMutation());
    act(() => result.current.mutate({ params: { userId: 'u1' } as never }));
    expect(await screen.findByText('重設連結已寄出。')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'userCredential', kind: 'update', id: 'u1' },
    ]);
  });

  it('對象還沒啟用 → 提示啟用信已寄出（後端寄的是啟用信）', async () => {
    api.resetPassword.mockResolvedValue(undefined);
    const result = render(() => useUserResetPasswordMutation());
    act(() => result.current.mutate({ params: { userId: 'u1', pending: true } }));
    expect(await screen.findByText('啟用信已寄出。')).toBeInTheDocument();
  });

  it('失敗 → 以 toast 顯示錯誤', async () => {
    api.resetPassword.mockRejectedValue(FORBIDDEN);
    const result = render(() => useUserResetPasswordMutation());
    act(() => result.current.mutate({ params: { userId: 'u1' } as never }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});

describe('useUserTagsReplaceMutation', () => {
  it('成功 → 宣告該使用者 update 並提示', async () => {
    api.tags.mockResolvedValue(undefined);
    const result = render(() => useUserTagsReplaceMutation());
    act(() => result.current.mutate({ params: { resourceId: 'u1' } as never }));
    expect(await screen.findByText('已更新標籤')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'user', kind: 'update', id: 'u1' },
    ]);
  });

  it('失敗 → 不彈 toast，錯誤交給對話框', async () => {
    api.tags.mockRejectedValue(FORBIDDEN);
    const result = render(() => useUserTagsReplaceMutation());
    act(() => result.current.mutate({ params: { resourceId: 'u1' } as never }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(screen.queryByText(FORBIDDEN_MESSAGE)).not.toBeInTheDocument();
  });
});
