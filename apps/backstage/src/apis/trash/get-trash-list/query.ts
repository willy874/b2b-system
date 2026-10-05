import type { HttpRequestDTO } from '@b2b-system/web-core/client';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { TrashListParams } from '../types';
import { fetchTrashListQuery } from './fetcher';

export const TRASH_LIST_QUERY_KEY = 'TRASH_LIST_QUERY_KEY';

const getTrashListQueryKeys = (params: TrashListParams) =>
  [TRASH_LIST_QUERY_KEY, params.type, params.offset, params.limit, params.keyword ?? ''] as const;

/** 回收桶的某一類（`<resource>:delete`；docs/architecture/backend/13-trash.md §3）。 */
export const getTrashListQueryOptions = (options: HttpRequestDTO<TrashListParams>) =>
  queryOptions({
    queryKey: getTrashListQueryKeys(options.params),
    placeholderData: keepPreviousData, // 換頁時不閃空白
    queryFn: ({ signal }) => fetchTrashListQuery({ params: options.params, signal }),
  });
