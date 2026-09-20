import { useMutation, useQueryClient } from '@tanstack/react-query';

import { AUDIT_LOG_LIST_QUERY_KEY } from '@/apis/audit-log/get-audit-log-list/query';
import { AUTH_PROFILE_QUERY_KEY } from '@/apis/auth/get-profile/query';
import { getRoleCreateMutationOptions } from '@/apis/role/create-role/mutation';
import { getRoleDeleteMutationOptions } from '@/apis/role/delete-role/mutation';
import { getRoleDuplicateMutationOptions } from '@/apis/role/duplicate-role/mutation';
import { ROLE_DETAIL_QUERY_KEY } from '@/apis/role/get-role-detail/query';
import { ROLE_LIST_QUERY_KEY, ROLE_OPTIONS_QUERY_KEY } from '@/apis/role/get-role-list/query';
import { ROLE_PERMISSIONS_QUERY_KEY } from '@/apis/role/get-role-permissions/query';
import { getGrantRolePermissionsMutationOptions } from '@/apis/role/grant-role-permissions/mutation';
import { getRoleUpdateMutationOptions } from '@/apis/role/update-role/mutation';
import { useToast } from '@/components/Toast';
import { broadcastInvalidate } from '@/core/cache';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';

function useInvalidate() {
  const queryClient = useQueryClient();
  return (keys: string[][]) => {
    for (const key of keys) broadcastInvalidate(key);
    // 任何寫入都會產生稽核紀錄
    void queryClient.invalidateQueries({ queryKey: [AUDIT_LOG_LIST_QUERY_KEY] });
  };
}

export function useRoleCreateMutation() {
  const invalidate = useInvalidate();
  const toast = useToast();
  const { t } = useTranslation();

  return useMutation({
    ...getRoleCreateMutationOptions(),
    onSuccess: (role) => {
      invalidate([[ROLE_LIST_QUERY_KEY], [ROLE_OPTIONS_QUERY_KEY]]);
      toast.success(t('role.create.success', { name: role.name }));
    },
  });
}

export function useRoleUpdateMutation() {
  const invalidate = useInvalidate();
  const toast = useToast();
  const { t } = useTranslation();

  return useMutation({
    ...getRoleUpdateMutationOptions(),
    onSuccess: (role) => {
      invalidate([[ROLE_LIST_QUERY_KEY], [ROLE_DETAIL_QUERY_KEY, role.id]]);
      toast.success(t('role.update.success'));
    },
  });
}

export function useRoleDeleteMutation() {
  const invalidate = useInvalidate();
  const toast = useToast();
  const { t } = useTranslation();
  const toMessage = useErrorMessage();

  return useMutation({
    ...getRoleDeleteMutationOptions(),
    onSuccess: () => {
      invalidate([[ROLE_LIST_QUERY_KEY], [ROLE_OPTIONS_QUERY_KEY]]);
      toast.success(t('role.delete.success'));
    },
    onError: (error) => toast.error(toMessage(error)),
  });
}

export function useRoleDuplicateMutation() {
  const invalidate = useInvalidate();
  const toast = useToast();
  const { t } = useTranslation();

  return useMutation({
    ...getRoleDuplicateMutationOptions(),
    onSuccess: (role) => {
      invalidate([[ROLE_LIST_QUERY_KEY], [ROLE_OPTIONS_QUERY_KEY]]);
      const skipped = role.skippedPermissions ?? [];
      if (skipped.length) {
        toast.warning(t('role.duplicate.partial', { count: skipped.length }));
      } else {
        toast.success(t('role.duplicate.success', { name: role.name }));
      }
    },
  });
}

export function useGrantRolePermissionsMutation(roleId: string) {
  const invalidate = useInvalidate();
  const toast = useToast();
  const { t } = useTranslation();
  const toMessage = useErrorMessage();

  return useMutation({
    ...getGrantRolePermissionsMutationOptions(),
    onSuccess: () => {
      invalidate([
        [ROLE_LIST_QUERY_KEY],
        [ROLE_DETAIL_QUERY_KEY, roleId],
        [ROLE_PERMISSIONS_QUERY_KEY, roleId],
        // 自己的權限可能也變了
        [AUTH_PROFILE_QUERY_KEY],
      ]);
      toast.success(t('role.permission.success'));
    },
    onError: (error) => toast.error(toMessage(error)),
  });
}
