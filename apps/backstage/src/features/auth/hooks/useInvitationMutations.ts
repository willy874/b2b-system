import { useMutation } from '@tanstack/react-query';

import { invalidateResources, Resource } from '@/apis/resources';
import { getAcceptWorkspaceInvitationMutationOptions } from '@/apis/workspace/accept-workspace-invitation/mutation';
import { getSignupWorkspaceInvitationMutationOptions } from '@/apis/workspace/signup-workspace-invitation/mutation';

/**
 * 已有帳號：以目前登入的帳號接受。成為成員後自己的工作區清單要重抓（切換器、導向）。
 * 錯誤不在這裡吞掉：由頁面顯示（例：WORKSPACE_INVITATION_EMAIL_MISMATCH）。
 */
export function useAcceptInvitationMutation() {
  return useMutation({
    ...getAcceptWorkspaceInvitationMutationOptions(),
    onSuccess: () => {
      invalidateResources([{ resource: Resource.WORKSPACE_MEMBER, kind: 'create' }]);
    },
  });
}

/** 還沒有帳號：建立帳號並加入；登入由頁面接著以 `useLoginMutation()` 完成。 */
export function useSignupInvitationMutation() {
  return useMutation(getSignupWorkspaceInvitationMutationOptions());
}
