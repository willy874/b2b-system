import { queryOptions } from '@tanstack/react-query';

import { fetchAnnouncementDetailQuery } from './fetcher';

export const ANNOUNCEMENT_DETAIL_QUERY_KEY = 'ANNOUNCEMENT_DETAIL_QUERY_KEY';

export const getAnnouncementDetailQueryOptions = (announcementId: string) =>
  queryOptions({
    queryKey: [ANNOUNCEMENT_DETAIL_QUERY_KEY, announcementId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchAnnouncementDetailQuery({ params: { announcementId: queryKey[1] }, signal }),
  });
