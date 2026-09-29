import { useMutation } from '@tanstack/react-query';

import { invalidateResources, Resource } from '@/apis/resources';
import { getAssignWorkspaceAdminMutationOptions } from '@/apis/workspace/assign-workspace-admin/mutation';
import { getCreateWorkspaceMutationOptions } from '@/apis/workspace/create-workspace/mutation';
import { getDeleteWorkspaceMemberMutationOptions } from '@/apis/workspace/delete-workspace-member/mutation';
import { getDeleteWorkspaceMutationOptions } from '@/apis/workspace/delete-workspace/mutation';
import { getUpdateWorkspaceMemberRolesMutationOptions } from '@/apis/workspace/update-workspace-member-roles/mutation';
import { getUpdateWorkspaceMutationOptions } from '@/apis/workspace/update-workspace/mutation';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';

/** 錯誤不在這裡吞掉：由對話框的呼叫端顯示（例：AUTHZ_ESCALATION、WORKSPACE_LAST_ADMIN）。 */
export function useUpdateWorkspaceMemberRolesMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getUpdateWorkspaceMemberRolesMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([
        { resource: Resource.WORKSPACE_MEMBER, kind: 'update', id: params.userId },
      ]);
      toast.success(t('workspace.member.editRoles.success'));
    },
  });
}

export function useDeleteWorkspaceMemberMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getDeleteWorkspaceMemberMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([
        { resource: Resource.WORKSPACE_MEMBER, kind: 'delete', id: params.userId },
      ]);
      toast.success(t('workspace.member.remove.success'));
    },
  });
}

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
