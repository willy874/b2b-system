import { useMutation } from '@tanstack/react-query';

import { getAcceptWorkspaceInvitationMutationOptions } from '@/apis/workspace/accept-workspace-invitation/mutation';
import { getSignupWorkspaceInvitationMutationOptions } from '@/apis/workspace/signup-workspace-invitation/mutation';
import type { AcceptedWorkspaceInvitation } from '@/shared/api-sdk';

/**
 * 接受後 **頂層跳轉** 到產品裡的工作區（docs/adr/0019-sso-identity-platform.md D6）：
 * 產品沒有 session 時經 IdP 登入，已有 IdP session 的人不必再輸入密碼。
 */
function enterWorkspace(accepted: AcceptedWorkspaceInvitation): void {
  globalThis.location.assign(accepted.workspaceUrl);
}

/** 已有帳號：以 apps/auth 目前登入的帳號接受。錯誤交給頁面顯示（例：WORKSPACE_INVITATION_EMAIL_MISMATCH）。 */
export function useAcceptInvitationMutation() {
  return useMutation({
    ...getAcceptWorkspaceInvitationMutationOptions(),
    onSuccess: enterWorkspace,
  });
}

/** 還沒有帳號：建立帳號並加入；登入在前往工作區時經 IdP 完成。 */
export function useSignupInvitationMutation() {
  return useMutation({
    ...getSignupWorkspaceInvitationMutationOptions(),
    onSuccess: enterWorkspace,
  });
}
