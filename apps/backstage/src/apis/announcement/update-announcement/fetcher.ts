import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

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
