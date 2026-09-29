import { queryOptions } from '@tanstack/react-query';

import { fetchWorkspaceInvitationPreviewQuery } from './fetcher';

export const WORKSPACE_INVITATION_PREVIEW_QUERY_KEY = 'WORKSPACE_INVITATION_PREVIEW_QUERY_KEY';

export const getWorkspaceInvitationPreviewQueryOptions = (token: string) =>
  queryOptions({
    queryKey: [WORKSPACE_INVITATION_PREVIEW_QUERY_KEY, token] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchWorkspaceInvitationPreviewQuery({ params: { token: queryKey[1] }, signal }),
    // 無效的連結重試也不會變有效
    retry: false,
    staleTime: Infinity,
  });
