import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { getMentionableUsersQueryOptions } from '@/apis/comment/get-mentionable-users/query';
import type { CommentTargetParams } from '@/apis/comment/types';

/** @提及的候選（後端已過濾成看得到資源的人）；選單打開才查，搜尋字變了沿用上一批直到新的回來。 */
export function useMentionableUsers(
  target: CommentTargetParams,
  keyword: string,
  enabled: boolean,
) {
  return useQuery({
    ...getMentionableUsersQueryOptions(target, keyword.trim()),
    enabled,
    placeholderData: keepPreviousData,
  });
}
