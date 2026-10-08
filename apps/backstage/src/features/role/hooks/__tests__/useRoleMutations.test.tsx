import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import {
  useGrantRolePermissionsMutation,
  useRoleCreateMutation,
  useRoleDuplicateMutation,
  useRoleRestoreMutation,
  useRoleRevertRevisionMutation,
  useRoleUpdateMutation,
} from '../useRoleMutations';

/** 刪除的「復原」、還原的佔用與反提權在 components/__tests__/RoleRestoreAction.test.tsx。 */
const api = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  restore: vi.fn(),
  duplicate: vi.fn(),
  grant: vi.fn(),
  revert: vi.fn(),
  invalidateResources: vi.fn(),
}));
vi.mock('@/apis/role/create-role/fetcher', () => ({ fetchRoleCreateMutation: api.create }));
vi.mock('@/apis/role/update-role/fetcher', () => ({ fetchRoleUpdateMutation: api.update }));
vi.mock('@/apis/role/restore-role/fetcher', () => ({ fetchRoleRestoreMutation: api.restore }));
vi.mock('@/apis/role/duplicate-role/fetcher', () => ({
  fetchRoleDuplicateMutation: api.duplicate,
}));
vi.mock('@/apis/role/grant-role-permissions/fetcher', () => ({
  fetchGrantRolePermissionsMutation: api.grant,
}));
vi.mock('@/apis/role/revert-role-revision/fetcher', () => ({
  fetchRoleRevertRevisionMutation: api.revert,
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

const ROLE = { id: 'r1', name: '內容編輯' };
const FORBIDDEN = new AppError('AUTHZ_FORBIDDEN', 403);
const FORBIDDEN_MESSAGE = '你沒有執行這個操作的權限。';
const CONFLICT_MESSAGE = '這個角色已經被其他人修改，請重新載入後再編輯。';

function render<T>(hook: () => T) {
  return renderHook(hook, { wrapper: AllProviders }).result;
}

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useRoleCreateMutation', () => {
  it('建立成功 → 宣告 role create 並提示名稱', async () => {
    api.create.mockResolvedValue(ROLE);
    const result = render(() => useRoleCreateMutation());
    act(() => result.current.mutate({ params: {} as never }));
    expect(await screen.findByText('已建立角色「內容編輯」。')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([{ resource: 'role', kind: 'create' }]);
  });
});

describe('useRoleUpdateMutation', () => {
  it('更新成功 → 宣告 role update 並提示', async () => {
    api.update.mockResolvedValue(ROLE);
    const result = render(() => useRoleUpdateMutation());
    act(() => result.current.mutate({ params: { roleId: 'r1' } as never }));
    expect(await screen.findByText('角色已更新。')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'role', kind: 'update', id: 'r1' },
    ]);
  });

  it('版本衝突 → 失效該角色，不彈 toast', async () => {
    api.update.mockRejectedValue(new AppError('ROLE_VERSION_CONFLICT', 409));
    const result = render(() => useRoleUpdateMutation());
    act(() => result.current.mutate({ params: { roleId: 'r1' } as never }));
    await waitFor(() =>
      expect(api.invalidateResources).toHaveBeenCalledWith([
        { resource: 'role', kind: 'update', id: 'r1' },
      ]),
    );
    expect(screen.queryByText(CONFLICT_MESSAGE)).not.toBeInTheDocument();
  });

  it('其他錯誤 → 以 toast 顯示、不失效', async () => {
    api.update.mockRejectedValue(FORBIDDEN);
    const result = render(() => useRoleUpdateMutation());
    act(() => result.current.mutate({ params: { roleId: 'r1' } as never }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });
});

describe('useRoleRestoreMutation', () => {
  it('還原成功 → 同時宣告 role create 與 update', async () => {
    api.restore.mockResolvedValue({ ...ROLE, holdersRestored: 0 });
    const result = render(() => useRoleRestoreMutation());
    act(() => result.current.mutate({ params: { roleId: 'r1' } }));
    expect(await screen.findByText('已還原「內容編輯」。')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'role', kind: 'create', id: 'r1' },
      { resource: 'role', kind: 'update', id: 'r1' },
    ]);
  });

  it('沒有佔用的角色、也不是反提權 → 一般錯誤 toast', async () => {
    api.restore.mockRejectedValue(FORBIDDEN);
    const result = render(() => useRoleRestoreMutation());
    act(() => result.current.mutate({ params: { roleId: 'r1' } }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看該角色' })).not.toBeInTheDocument();
  });
});

describe('useRoleDuplicateMutation', () => {
  it('全部複製 → 宣告 role create 並提示新名稱', async () => {
    api.duplicate.mockResolvedValue({ id: 'r2', name: '內容編輯（副本）', skippedPermissions: [] });
    const result = render(() => useRoleDuplicateMutation());
    act(() => result.current.mutate({ params: { roleId: 'r1' } as never }));
    expect(await screen.findByText('已複製為「內容編輯（副本）」。')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([{ resource: 'role', kind: 'create' }]);
  });

  it('沒有 skippedPermissions 欄位 → 當成全部複製', async () => {
    api.duplicate.mockResolvedValue({ id: 'r2', name: '副本' });
    const result = render(() => useRoleDuplicateMutation());
    act(() => result.current.mutate({ params: { roleId: 'r1' } as never }));
    expect(await screen.findByText('已複製為「副本」。')).toBeInTheDocument();
  });

  it('有自己未持有的權限被略過 → 警告略過的數量', async () => {
    api.duplicate.mockResolvedValue({
      id: 'r2',
      name: '副本',
      skippedPermissions: ['user:delete', 'role:delete'],
    });
    const result = render(() => useRoleDuplicateMutation());
    act(() => result.current.mutate({ params: { roleId: 'r1' } as never }));
    expect(await screen.findByText('已複製，但有 2 個你未持有的權限被略過。')).toBeInTheDocument();
  });

  it('失敗 → 以 toast 顯示錯誤', async () => {
    api.duplicate.mockRejectedValue(FORBIDDEN);
    const result = render(() => useRoleDuplicateMutation());
    act(() => result.current.mutate({ params: { roleId: 'r1' } as never }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});

describe('useGrantRolePermissionsMutation', () => {
  it('成功 → 宣告 rolePermission update 並提示', async () => {
    api.grant.mockResolvedValue(undefined);
    const result = render(() => useGrantRolePermissionsMutation());
    act(() => result.current.mutate({ params: { roleId: 'r1' } as never }));
    expect(await screen.findByText('角色權限已更新。')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'rolePermission', kind: 'update', id: 'r1' },
    ]);
  });

  it('失敗 → 以 toast 顯示錯誤', async () => {
    api.grant.mockRejectedValue(FORBIDDEN);
    const result = render(() => useGrantRolePermissionsMutation());
    act(() => result.current.mutate({ params: { roleId: 'r1' } as never }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});

describe('useRoleRevertRevisionMutation', () => {
  const params = { roleId: 'r1', version: 3 } as never;

  it('還原成功 → 宣告 role 與 rolePermission update，提示版本', async () => {
    api.revert.mockResolvedValue(ROLE);
    const result = render(() => useRoleRevertRevisionMutation());
    act(() => result.current.mutate({ params }));
    expect(await screen.findByText('已還原到第 3 版。')).toBeInTheDocument();
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'role', kind: 'update', id: 'r1' },
      { resource: 'rolePermission', kind: 'update', id: 'r1' },
    ]);
  });

  it('版本衝突 → 失效該角色，不彈 toast', async () => {
    api.revert.mockRejectedValue(new AppError('ROLE_VERSION_CONFLICT', 409));
    const result = render(() => useRoleRevertRevisionMutation());
    act(() => result.current.mutate({ params }));
    await waitFor(() =>
      expect(api.invalidateResources).toHaveBeenCalledWith([
        { resource: 'role', kind: 'update', id: 'r1' },
      ]),
    );
    expect(screen.queryByText(CONFLICT_MESSAGE)).not.toBeInTheDocument();
  });

  it('反提權（AUTHZ_ESCALATION）→ 說明這一版帶有未持有的權限', async () => {
    api.revert.mockRejectedValue(new AppError('AUTHZ_ESCALATION', 403));
    const result = render(() => useRoleRevertRevisionMutation());
    act(() => result.current.mutate({ params }));
    expect(await screen.findByText('這一版帶有你未持有的權限，無法還原。')).toBeInTheDocument();
    expect(api.invalidateResources).not.toHaveBeenCalled();
  });

  it('其他錯誤 → 以 toast 顯示錯誤碼的訊息', async () => {
    api.revert.mockRejectedValue(FORBIDDEN);
    const result = render(() => useRoleRevertRevisionMutation());
    act(() => result.current.mutate({ params }));
    expect(await screen.findByText(FORBIDDEN_MESSAGE)).toBeInTheDocument();
  });
});
