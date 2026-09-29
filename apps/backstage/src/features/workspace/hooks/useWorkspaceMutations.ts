import { useMutation } from '@tanstack/react-query';

import { invalidateResources, Resource } from '@/apis/resources';
import { getAssignWorkspaceAdminMutationOptions } from '@/apis/workspace/assign-workspace-admin/mutation';
import { getCreateWorkspaceInvitationMutationOptions } from '@/apis/workspace/create-workspace-invitation/mutation';
import { getCreateWorkspaceMutationOptions } from '@/apis/workspace/create-workspace/mutation';
import { getDeleteWorkspaceMemberMutationOptions } from '@/apis/workspace/delete-workspace-member/mutation';
import { getDeleteWorkspaceMutationOptions } from '@/apis/workspace/delete-workspace/mutation';
import { getRevokeWorkspaceInvitationMutationOptions } from '@/apis/workspace/revoke-workspace-invitation/mutation';
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

/** 錯誤由對話框顯示（例：AUTHZ_ESCALATION、WORKSPACE_INVITATION_USER_CREATE_REQUIRED）。 */
export function useCreateWorkspaceInvitationMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getCreateWorkspaceInvitationMutationOptions(),
    onSuccess: (invitation) => {
      // 重新邀請同一個 email 會撤銷舊的：清單整個重抓
      invalidateResources([
        { resource: Resource.WORKSPACE_INVITATION, kind: 'create', id: invitation.id },
      ]);
      toast.success(t('workspace.invitation.create.success', { email: invitation.email }));
    },
  });
}

export function useRevokeWorkspaceInvitationMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getRevokeWorkspaceInvitationMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([
        { resource: Resource.WORKSPACE_INVITATION, kind: 'delete', id: params.invitationId },
      ]);
      toast.success(t('workspace.invitation.revoke.success'));
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
