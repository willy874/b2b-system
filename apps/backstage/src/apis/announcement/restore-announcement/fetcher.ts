import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getAnnouncementControllerRestoreUrl } from '@/shared/api-sdk';
import type { Announcement } from '@/shared/api-sdk';

export const fetchAnnouncementRestoreMutation = defineAuthFetcher<
  HttpRequestDTO<{ announcementId: string }>,
  Announcement
>((http, request) =>
  http.request(getAnnouncementControllerRestoreUrl({ id: request.params.announcementId }), {
    method: 'POST',
  }),
);
