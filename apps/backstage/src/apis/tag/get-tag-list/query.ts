import { queryOptions } from '@tanstack/react-query';

import type { TagScope } from '../types';
import { fetchTagListQuery } from './fetcher';

/** 第二個元素是標籤組。 */
export const TAG_LIST_QUERY_KEY = 'TAG_LIST_QUERY_KEY';

/** 一個標籤組的全部標籤（最多 200 個，不分頁；docs/architecture/backend/18-tag.md §7.2 D11）。 */
export const getTagListQueryOptions = (scope: TagScope) =>
  queryOptions({
    queryKey: [TAG_LIST_QUERY_KEY, scope] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchTagListQuery({ params: { scope: queryKey[1] }, signal }),
  });
