import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAnnouncementControllerFindOneUrl } from '@/shared/api-sdk';
import type { Announcement } from '@/shared/api-sdk';

export const fetchAnnouncementDetailQuery = defineAuthFetcher<
  HttpRequestDTO<{ announcementId: string }>,
  Announcement
>((http, request) =>
  http.request(getAnnouncementControllerFindOneUrl({ id: request.params.announcementId }), {
    method: 'GET',
  }),
);
