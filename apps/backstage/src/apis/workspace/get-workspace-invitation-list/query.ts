import { queryOptions } from '@tanstack/react-query';

import { fetchWorkspaceInvitationListQuery } from './fetcher';

export const WORKSPACE_INVITATION_LIST_QUERY_KEY = 'WORKSPACE_INVITATION_LIST_QUERY_KEY';

/** 待接受的邀請（含已過期）；筆數少，不分頁。 */
export const getWorkspaceInvitationListQueryOptions = (workspaceId: string) =>
  queryOptions({
    queryKey: [WORKSPACE_INVITATION_LIST_QUERY_KEY, workspaceId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchWorkspaceInvitationListQuery({ params: { workspaceId: queryKey[1] }, signal }),
  });
