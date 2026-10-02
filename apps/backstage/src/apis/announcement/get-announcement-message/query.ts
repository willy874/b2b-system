import { queryOptions } from '@tanstack/react-query';

import { fetchAnnouncementMessageQuery } from './fetcher';

export const ANNOUNCEMENT_MESSAGE_QUERY_KEY = 'ANNOUNCEMENT_MESSAGE_QUERY_KEY';

/** 收件人讀全文：後端同時把那則通知標為已讀（docs/architecture/backend/19-announcement.md §9.2 D4）。 */
export const getAnnouncementMessageQueryOptions = (dispatchId: string) =>
  queryOptions({
    queryKey: [ANNOUNCEMENT_MESSAGE_QUERY_KEY, dispatchId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchAnnouncementMessageQuery({ params: { dispatchId: queryKey[1] }, signal }),
  });
