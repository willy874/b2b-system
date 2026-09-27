import { useMutation } from '@tanstack/react-query';

import { invalidateResources, Resource } from '@/apis/resources';
import { getAssignUserRolesMutationOptions } from '@/apis/user/assign-user-roles/mutation';
import { getUserCreateMutationOptions } from '@/apis/user/create-user/mutation';
import { getUserDeleteMutationOptions } from '@/apis/user/delete-user/mutation';
import { getUserResetPasswordMutationOptions } from '@/apis/user/reset-user-password/mutation';
import { getUserUnlockMutationOptions } from '@/apis/user/unlock-user/mutation';
import { getUserUpdateMutationOptions } from '@/apis/user/update-user/mutation';
import { useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';
import type { User } from '@/shared/api-sdk';

/** 使用者持有的角色：讓依賴圖只失效這幾個角色，而不是全部。 */
export const roleRefs = (user: Pick<User, 'roles'>) => ({
  role: user.roles.map((role) => role.id),
});

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
