import { useMutation } from '@tanstack/react-query';

import { invalidateResources, Resource } from '@/apis/resources';
import { getCreateWorkspaceInvitationMutationOptions } from '@/apis/workspace/create-workspace-invitation/mutation';
import { getDeleteWorkspaceMemberMutationOptions } from '@/apis/workspace/delete-workspace-member/mutation';
import { getRevokeWorkspaceInvitationMutationOptions } from '@/apis/workspace/revoke-workspace-invitation/mutation';
import { getUpdateWorkspaceMemberRolesMutationOptions } from '@/apis/workspace/update-workspace-member-roles/mutation';
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
