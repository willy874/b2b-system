import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { AnnouncementAudience } from '@/shared/api-sdk';

import { fetchAnnouncementAudiencePreviewQuery } from './fetcher';

export const ANNOUNCEMENT_AUDIENCE_PREVIEW_QUERY_KEY = 'ANNOUNCEMENT_AUDIENCE_PREVIEW_QUERY_KEY';

/**
 * 受眾的人數預覽：`POST` 但不寫入，當 query 用（受眾改變就重抓）。key 用排序過的 id 串，
 * 同一組受眾不同的勾選順序共用快取。
 */
export const getAnnouncementAudiencePreviewQueryOptions = (audience: AnnouncementAudience) =>
  queryOptions({
    queryKey: [
      ANNOUNCEMENT_AUDIENCE_PREVIEW_QUERY_KEY,
      audience.all,
      audience.userIds.toSorted().join(','),
      audience.groupIds.toSorted().join(','),
      audience.roleIds.toSorted().join(','),
    ] as const,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchAnnouncementAudiencePreviewQuery({ params: audience, signal }),
  });
