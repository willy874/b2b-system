import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

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
