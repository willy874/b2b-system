import type { HttpRequestDTO } from '@b2b-system/web-core/client';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { AnnouncementListParams } from '../types';
import { fetchAnnouncementListQuery } from './fetcher';

export const ANNOUNCEMENT_LIST_QUERY_KEY = 'ANNOUNCEMENT_LIST_QUERY_KEY';

export const getAnnouncementListQueryOptions = (options: HttpRequestDTO<AnnouncementListParams>) =>
  queryOptions({
    queryKey: [
      ANNOUNCEMENT_LIST_QUERY_KEY,
      options.params.offset,
      options.params.limit,
      options.params.keyword,
      options.params.status,
    ] as const,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchAnnouncementListQuery({ params: options.params, signal }),
  });
