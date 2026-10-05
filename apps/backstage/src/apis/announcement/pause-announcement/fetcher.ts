import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getAnnouncementControllerPauseUrl } from '@/shared/api-sdk';
import type { Announcement, AnnouncementActionRequest } from '@/shared/api-sdk';

export const fetchAnnouncementPauseMutation = defineAuthFetcher<
  HttpRequestDTO<{ announcementId: string; body: AnnouncementActionRequest }>,
  Announcement
>((http, request) =>
  http.request(
    getAnnouncementControllerPauseUrl({ id: request.params.announcementId }),
    jsonBody(request.params.body, { method: 'POST' }),
  ),
);
