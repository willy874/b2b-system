import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getAnnouncementControllerRemoveUrl } from '@/shared/api-sdk';

export const fetchAnnouncementDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<{ announcementId: string }>,
  undefined
>((http, request) =>
  http.request(getAnnouncementControllerRemoveUrl({ id: request.params.announcementId }), {
    method: 'DELETE',
  }),
);
