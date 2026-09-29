import { useNavigate } from '@tanstack/react-router';

import type { AcceptedWorkspaceInvitation } from '@/shared/api-sdk';

import { WorkspaceRoute } from '../routes/external';

/** 接受邀請後進入那個工作區（`/w/:slug` 會再導到工作區的預設頁）。 */
export function useEnterInvitedWorkspace() {
  const navigate = useNavigate();
  return (accepted: AcceptedWorkspaceInvitation) =>
    navigate({ to: WorkspaceRoute.to, params: { workspaceSlug: accepted.workspace.slug } });
}
