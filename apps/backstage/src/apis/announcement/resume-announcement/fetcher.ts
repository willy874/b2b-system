import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAnnouncementControllerResumeUrl } from '@/shared/api-sdk';
import type { Announcement, AnnouncementActionRequest } from '@/shared/api-sdk';

export const fetchAnnouncementResumeMutation = defineAuthFetcher<
  HttpRequestDTO<{ announcementId: string; body: AnnouncementActionRequest }>,
  Announcement
>((http, request) =>
  http.request(
    getAnnouncementControllerResumeUrl({ id: request.params.announcementId }),
    jsonBody(request.params.body, { method: 'POST' }),
  ),
);
