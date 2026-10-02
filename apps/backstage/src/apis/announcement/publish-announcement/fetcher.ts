import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAnnouncementControllerPublishUrl } from '@/shared/api-sdk';
import type { Announcement, AnnouncementActionRequest } from '@/shared/api-sdk';

export const fetchAnnouncementPublishMutation = defineAuthFetcher<
  HttpRequestDTO<{ announcementId: string; body: AnnouncementActionRequest }>,
  Announcement
>((http, request) =>
  http.request(
    getAnnouncementControllerPublishUrl({ id: request.params.announcementId }),
    jsonBody(request.params.body, { method: 'POST' }),
  ),
);
