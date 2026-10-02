import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { HttpRequestDTO } from '@/core/client';

import type { AnnouncementDispatchListParams } from '../types';
import { fetchAnnouncementDispatchesQuery } from './fetcher';

/** 第二個元素是公告 id：依賴圖以 `[KEY, announcementId]` 失效某則公告的發送紀錄。 */
export const ANNOUNCEMENT_DISPATCHES_QUERY_KEY = 'ANNOUNCEMENT_DISPATCHES_QUERY_KEY';

export const getAnnouncementDispatchesQueryOptions = (
  options: HttpRequestDTO<AnnouncementDispatchListParams>,
) =>
  queryOptions({
    queryKey: [
      ANNOUNCEMENT_DISPATCHES_QUERY_KEY,
      options.params.announcementId,
      options.params.offset,
      options.params.limit,
    ] as const,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchAnnouncementDispatchesQuery({ params: options.params, signal }),
  });
