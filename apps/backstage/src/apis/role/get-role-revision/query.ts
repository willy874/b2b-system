import { queryOptions } from '@tanstack/react-query';

import { fetchRoleRevisionQuery } from './fetcher';

export const ROLE_REVISION_DETAIL_QUERY_KEY = 'ROLE_REVISION_DETAIL_QUERY_KEY';

/** 角色的某一版（含快照）。版本寫入後不會改變，但會被保留清理刪除，所以仍隨角色失效。 */
export const getRoleRevisionQueryOptions = (roleId: string, version: number) =>
  queryOptions({
    queryKey: [ROLE_REVISION_DETAIL_QUERY_KEY, roleId, version] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchRoleRevisionQuery({ params: { roleId: queryKey[1], version: queryKey[2] }, signal }),
  });
