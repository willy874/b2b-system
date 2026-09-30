import { useMutation } from '@tanstack/react-query';

import { invalidateResources, Resource } from '@/apis/resources';
import { getRoleCreateMutationOptions } from '@/apis/role/create-role/mutation';
import { getRoleDeleteMutationOptions } from '@/apis/role/delete-role/mutation';
import { getRoleDuplicateMutationOptions } from '@/apis/role/duplicate-role/mutation';
import { getGrantRolePermissionsMutationOptions } from '@/apis/role/grant-role-permissions/mutation';
import { getRoleUpdateMutationOptions } from '@/apis/role/update-role/mutation';
import { isVersionConflict, useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';

export function useRoleCreateMutation() {
  const toast = useToast();
  const { t } = useTranslation();

  return useMutation({
    ...getRoleCreateMutationOptions(),
    onSuccess: (role) => {
      invalidateResources([{ resource: Resource.ROLE, kind: 'create' }]);
      toast.success(t('role.create.success', { name: role.name }));
    },
  });
}

/**
 * 編輯角色：表單帶上編輯開始時的 `version`（樂觀鎖）。別人搶先改過時後端回 `ROLE_VERSION_CONFLICT`，
 * 這裡失效該角色讓畫面拿到最新的內容與版本，訊息交給表單（`VersionConflictAlert`）顯示、不彈 toast。
 */
export function useRoleUpdateMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();

  return useMutation({
    ...getRoleUpdateMutationOptions(),
    onSuccess: (role) => {
      invalidateResources([{ resource: Resource.ROLE, kind: 'update', id: role.id }]);
      toast.success(t('role.update.success'));
    },
    onError: (error, { params }) => {
      if (isVersionConflict(error)) {
        invalidateResources([{ resource: Resource.ROLE, kind: 'update', id: params.roleId }]);
        return;
      }
      showError(error);
    },
  });
}

export function useRoleDeleteMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();

  return useMutation({
    ...getRoleDeleteMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([{ resource: Resource.ROLE, kind: 'delete', id: params.roleId }]);
      toast.success(t('role.delete.success'));
    },
    onError: showError,
  });
}

export function useRoleDuplicateMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();

  return useMutation({
    ...getRoleDuplicateMutationOptions(),
    onSuccess: (role) => {
      invalidateResources([{ resource: Resource.ROLE, kind: 'create' }]);
      const skipped = role.skippedPermissions ?? [];
      if (skipped.length) {
        toast.warning(t('role.duplicate.partial', { count: skipped.length }));
      } else {
        toast.success(t('role.duplicate.success', { name: role.name }));
      }
    },
    onError: showError,
  });
}

export function useGrantRolePermissionsMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();

  return useMutation({
    ...getGrantRolePermissionsMutationOptions(),
    onSuccess: (_, { params }) => {
      // 自己持有這個角色時，依賴圖會一併失效 profile
      invalidateResources([
        { resource: Resource.ROLE_PERMISSION, kind: 'update', id: params.roleId },
      ]);
      toast.success(t('role.permission.success'));
    },
    onError: showError,
  });
}
