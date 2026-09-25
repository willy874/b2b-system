import { useMutation } from '@tanstack/react-query';

import { invalidateResources, Resource } from '@/apis/resources';
import { getAssignUserRolesMutationOptions } from '@/apis/user/assign-user-roles/mutation';
import { getUserBatchDeleteMutationOptions } from '@/apis/user/batch-delete-user/mutation';
import { getUserBatchUnlockMutationOptions } from '@/apis/user/batch-unlock-user/mutation';
import { getUserBatchStatusMutationOptions } from '@/apis/user/batch-update-user-status/mutation';
import { getUserCreateMutationOptions } from '@/apis/user/create-user/mutation';
import { getUserDeleteMutationOptions } from '@/apis/user/delete-user/mutation';
import { getUserResetPasswordMutationOptions } from '@/apis/user/reset-user-password/mutation';
import { getUserUnlockMutationOptions } from '@/apis/user/unlock-user/mutation';
import { getUserUpdateMutationOptions } from '@/apis/user/update-user/mutation';
import { useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';
import type { BatchResult, User } from '@/shared/api-sdk';

/** 使用者持有的角色：讓依賴圖只失效這幾個角色，而不是全部。 */
const roleRefs = (user: Pick<User, 'roles'>) => ({ role: user.roles.map((role) => role.id) });

export function useUserCreateMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getUserCreateMutationOptions(),
    onSuccess: (user) => {
      invalidateResources([{ resource: Resource.USER, kind: 'create', refs: roleRefs(user) }]);
      toast.success(t('user.create.success', { email: user.email }));
    },
  });
}

export function useUserUpdateMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getUserUpdateMutationOptions(),
    onSuccess: (user) => {
      invalidateResources([
        { resource: Resource.USER, kind: 'update', id: user.id, refs: roleRefs(user) },
      ]);
      toast.success(t('user.update.success'));
    },
    onError: showError,
  });
}

export function useUserDeleteMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getUserDeleteMutationOptions(),
    onSuccess: (_, { params }) => {
      // 不知道被刪的人持有哪些角色 → 角色端退回整批失效
      invalidateResources([{ resource: Resource.USER, kind: 'delete', id: params.userId }]);
      toast.success(t('user.delete.success'));
    },
    onError: showError,
  });
}

/** `user` 是指派前的狀態：新舊角色都要失效（userCount 與持有者清單）。 */
export function useAssignUserRolesMutation(user: Pick<User, 'id' | 'roles'>) {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getAssignUserRolesMutationOptions(),
    onSuccess: (_, { params }) => {
      const roleIds = new Set([...roleRefs(user).role, ...params.body.roleIds]);
      // 指派給自己時，依賴圖會一併失效 profile
      invalidateResources([
        { resource: Resource.USER_ROLE, kind: 'update', id: user.id, refs: { role: [...roleIds] } },
      ]);
      toast.success(t('user.assignRole.success'));
    },
    onError: showError,
  });
}

export function useUserUnlockMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getUserUnlockMutationOptions(),
    onSuccess: (user) => {
      invalidateResources([
        { resource: Resource.USER, kind: 'update', id: user.id, refs: roleRefs(user) },
      ]);
      toast.success(t('user.unlock.success'));
    },
    onError: showError,
  });
}

export function useUserResetPasswordMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getUserResetPasswordMutationOptions(),
    onSuccess: (_, { params }) => {
      // 畫面上看不到憑證，但會產生稽核紀錄
      invalidateResources([
        { resource: Resource.USER_CREDENTIAL, kind: 'update', id: params.userId },
      ]);
      toast.success(t('user.resetPassword.success'));
    },
    onError: showError,
  });
}

// ── 批次（ADR-0009）：提示與結果對話框由 RichTable 的批次流程處理，這裡只負責失效快取 ──

/**
 * 成功時只失效實際改到的那幾筆；整批失敗（網路、500）時已提交的筆數不明，送出的全部失效。
 * 不知道各自持有哪些角色 → 不帶 refs，角色端退回整批失效（同單筆刪除）。
 */
function invalidateBatch(kind: 'update' | 'delete') {
  return (
    result: BatchResult | undefined,
    _error: unknown,
    { params }: { params: { body: { ids: string[] } } },
  ) => {
    const ids = result?.succeeded ?? params.body.ids;
    invalidateResources(ids.map((id) => ({ resource: Resource.USER, kind, id })));
  };
}

export function useUserBatchDeleteMutation() {
  return useMutation({
    ...getUserBatchDeleteMutationOptions(),
    onSettled: invalidateBatch('delete'),
  });
}

export function useUserBatchUnlockMutation() {
  return useMutation({
    ...getUserBatchUnlockMutationOptions(),
    onSettled: invalidateBatch('update'),
  });
}

export function useUserBatchStatusMutation() {
  return useMutation({
    ...getUserBatchStatusMutationOptions(),
    onSettled: invalidateBatch('update'),
  });
}
