import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAnnouncementControllerUpdateUrl } from '@/shared/api-sdk';
import type { Announcement, UpdateAnnouncementRequest } from '@/shared/api-sdk';

export const fetchAnnouncementUpdateMutation = defineAuthFetcher<
  HttpRequestDTO<{ announcementId: string; body: UpdateAnnouncementRequest }>,
  Announcement
>((http, request) =>
  http.request(
    getAnnouncementControllerUpdateUrl({ id: request.params.announcementId }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
