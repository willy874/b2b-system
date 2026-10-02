import { queryOptions } from '@tanstack/react-query';

import { fetchAnnouncementTriggerEventsQuery } from './fetcher';

export const ANNOUNCEMENT_TRIGGER_EVENTS_QUERY_KEY = 'ANNOUNCEMENT_TRIGGER_EVENTS_QUERY_KEY';

/** 可以訂的觸發點（程式登記的目錄，只隨 feature 啟用而變）：很少變，快取久一點。 */
export const getAnnouncementTriggerEventsQueryOptions = () =>
  queryOptions({
    queryKey: [ANNOUNCEMENT_TRIGGER_EVENTS_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchAnnouncementTriggerEventsQuery({ params: undefined, signal }),
    staleTime: 5 * 60_000,
  });
