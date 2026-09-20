import { useMutation, useQueryClient } from '@tanstack/react-query';

import { AUDIT_LOG_LIST_QUERY_KEY } from '@/apis/audit-log/get-audit-log-list/query';
import { AUTH_PROFILE_QUERY_KEY } from '@/apis/auth/get-profile/query';
import { getAssignUserRolesMutationOptions } from '@/apis/user/assign-user-roles/mutation';
import { getUserCreateMutationOptions } from '@/apis/user/create-user/mutation';
import { getUserDeleteMutationOptions } from '@/apis/user/delete-user/mutation';
import { USER_DETAIL_QUERY_KEY } from '@/apis/user/get-user-detail/query';
import { USER_LIST_QUERY_KEY } from '@/apis/user/get-user-list/query';
import { USER_ROLES_QUERY_KEY } from '@/apis/user/get-user-roles/query';
import { getUserResetPasswordMutationOptions } from '@/apis/user/reset-user-password/mutation';
import { getUserUnlockMutationOptions } from '@/apis/user/unlock-user/mutation';
import { getUserUpdateMutationOptions } from '@/apis/user/update-user/mutation';
import { useToast } from '@/components/Toast';
import { broadcastInvalidate } from '@/core/cache';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';

function useInvalidate() {
  const queryClient = useQueryClient();
  return (keys: unknown[][]) => {
    for (const key of keys) broadcastInvalidate(key);
    void queryClient.invalidateQueries({ queryKey: [AUDIT_LOG_LIST_QUERY_KEY] });
  };
}

export function useUserCreateMutation() {
  const invalidate = useInvalidate();
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getUserCreateMutationOptions(),
    onSuccess: (user) => {
      invalidate([[USER_LIST_QUERY_KEY]]);
      toast.success(t('user.create.success', { email: user.email }));
    },
  });
}

export function useUserUpdateMutation() {
  const invalidate = useInvalidate();
  const toast = useToast();
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  return useMutation({
    ...getUserUpdateMutationOptions(),
    onSuccess: (user) => {
      invalidate([[USER_LIST_QUERY_KEY], [USER_DETAIL_QUERY_KEY, user.id]]);
      toast.success(t('user.update.success'));
    },
    onError: (error) => toast.error(toMessage(error)),
  });
}

export function useUserDeleteMutation() {
  const invalidate = useInvalidate();
  const toast = useToast();
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  return useMutation({
    ...getUserDeleteMutationOptions(),
    onSuccess: () => {
      invalidate([[USER_LIST_QUERY_KEY]]);
      toast.success(t('user.delete.success'));
    },
    onError: (error) => toast.error(toMessage(error)),
  });
}

export function useAssignUserRolesMutation(userId: string, isSelf: boolean) {
  const invalidate = useInvalidate();
  const toast = useToast();
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  return useMutation({
    ...getAssignUserRolesMutationOptions(),
    onSuccess: () => {
      const keys: unknown[][] = [
        [USER_LIST_QUERY_KEY],
        [USER_DETAIL_QUERY_KEY, userId],
        [USER_ROLES_QUERY_KEY, userId],
      ];
      if (isSelf) keys.push([AUTH_PROFILE_QUERY_KEY]);
      invalidate(keys);
      toast.success(t('user.assignRole.success'));
    },
    onError: (error) => toast.error(toMessage(error)),
  });
}

export function useUserUnlockMutation() {
  const invalidate = useInvalidate();
  const toast = useToast();
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  return useMutation({
    ...getUserUnlockMutationOptions(),
    onSuccess: (user) => {
      invalidate([[USER_LIST_QUERY_KEY], [USER_DETAIL_QUERY_KEY, user.id]]);
      toast.success(t('user.unlock.success'));
    },
    onError: (error) => toast.error(toMessage(error)),
  });
}

export function useUserResetPasswordMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  return useMutation({
    ...getUserResetPasswordMutationOptions(),
    onSuccess: () => toast.success(t('user.resetPassword.success')),
    onError: (error) => toast.error(toMessage(error)),
  });
}
