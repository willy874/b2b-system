import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getAnnouncementMessageControllerReadUrl } from '@/shared/api-sdk';
import type { AnnouncementMessage } from '@/shared/api-sdk';

export const fetchAnnouncementMessageQuery = defineAuthFetcher<
  HttpRequestDTO<{ dispatchId: string }>,
  AnnouncementMessage
>((http, request) =>
  http.request(getAnnouncementMessageControllerReadUrl({ dispatchId: request.params.dispatchId }), {
    method: 'GET',
  }),
);
