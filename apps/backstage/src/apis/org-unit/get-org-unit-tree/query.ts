import { queryOptions } from '@tanstack/react-query';

import { fetchOrgUnitTreeQuery } from './fetcher';

/** 整棵部門樹（扁平陣列）：組織頁、部門選擇器、使用者列表的篩選共用。 */
export const ORG_UNIT_TREE_QUERY_KEY = 'ORG_UNIT_TREE_QUERY_KEY';

export const getOrgUnitTreeQueryOptions = (keyword?: string) =>
  queryOptions({
    queryKey: [ORG_UNIT_TREE_QUERY_KEY, keyword ?? ''] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchOrgUnitTreeQuery({ params: { keyword: queryKey[1] || undefined }, signal }),
  });
