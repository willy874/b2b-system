import { useMutation } from '@tanstack/react-query';

import { invalidateResources, Resource } from '@/apis/resources';
import { getAssignWorkspaceAdminMutationOptions } from '@/apis/workspace/assign-workspace-admin/mutation';
import { getCreateWorkspaceMutationOptions } from '@/apis/workspace/create-workspace/mutation';
import { getDeleteWorkspaceMutationOptions } from '@/apis/workspace/delete-workspace/mutation';
import { getUpdateWorkspaceMutationOptions } from '@/apis/workspace/update-workspace/mutation';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';

/** 平台的租戶管理（docs/adr/0019-sso-identity-platform.md D13）。錯誤不在這裡吞掉：由對話框的呼叫端顯示。 */
export function useCreateWorkspaceMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getCreateWorkspaceMutationOptions(),
    onSuccess: (workspace) => {
      invalidateResources([
        { resource: Resource.WORKSPACE, kind: 'create', id: workspace.id },
        // 自己可能就是第一位管理員：切換器要看得到
        { resource: Resource.WORKSPACE_MEMBER, kind: 'update' },
      ]);
      toast.success(t('workspace.admin.create.success'));
    },
  });
}

export function useUpdateWorkspaceMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getUpdateWorkspaceMutationOptions(),
    onSuccess: (workspace) => {
      invalidateResources([{ resource: Resource.WORKSPACE, kind: 'update', id: workspace.id }]);
      toast.success(t('workspace.admin.edit.success'));
    },
  });
}

export function useAssignWorkspaceAdminMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getAssignWorkspaceAdminMutationOptions(),
    onSuccess: (workspace, { params }) => {
      invalidateResources([
        { resource: Resource.WORKSPACE, kind: 'update', id: workspace.id },
        { resource: Resource.WORKSPACE_MEMBER, kind: 'update', id: params.userId },
      ]);
      toast.success(t('workspace.admin.assignAdmin.success'));
    },
  });
}

export function useDeleteWorkspaceMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getDeleteWorkspaceMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([
        { resource: Resource.WORKSPACE, kind: 'delete', id: params.workspaceId },
      ]);
      toast.success(t('workspace.admin.remove.success'));
    },
  });
}
