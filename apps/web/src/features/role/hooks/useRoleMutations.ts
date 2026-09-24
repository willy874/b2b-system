import { useMutation } from '@tanstack/react-query';

import { invalidateResources, Resource } from '@/apis/resources';
import { getRoleCreateMutationOptions } from '@/apis/role/create-role/mutation';
import { getRoleDeleteMutationOptions } from '@/apis/role/delete-role/mutation';
import { getRoleDuplicateMutationOptions } from '@/apis/role/duplicate-role/mutation';
import { getGrantRolePermissionsMutationOptions } from '@/apis/role/grant-role-permissions/mutation';
import { getRoleUpdateMutationOptions } from '@/apis/role/update-role/mutation';
import { useToast } from '@/components/Toast';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';

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

export function useRoleUpdateMutation() {
  const toast = useToast();
  const { t } = useTranslation();

  return useMutation({
    ...getRoleUpdateMutationOptions(),
    onSuccess: (role) => {
      invalidateResources([{ resource: Resource.ROLE, kind: 'update', id: role.id }]);
      toast.success(t('role.update.success'));
    },
  });
}

export function useRoleDeleteMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const toMessage = useErrorMessage();

  return useMutation({
    ...getRoleDeleteMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([{ resource: Resource.ROLE, kind: 'delete', id: params.roleId }]);
      toast.success(t('role.delete.success'));
    },
    onError: (error) => toast.error(toMessage(error)),
  });
}

export function useRoleDuplicateMutation() {
  const toast = useToast();
  const { t } = useTranslation();

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
  });
}

export function useGrantRolePermissionsMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const toMessage = useErrorMessage();

  return useMutation({
    ...getGrantRolePermissionsMutationOptions(),
    onSuccess: (_, { params }) => {
      // 自己持有這個角色時，依賴圖會一併失效 profile
      invalidateResources([
        { resource: Resource.ROLE_PERMISSION, kind: 'update', id: params.roleId },
      ]);
      toast.success(t('role.permission.success'));
    },
    onError: (error) => toast.error(toMessage(error)),
  });
}
