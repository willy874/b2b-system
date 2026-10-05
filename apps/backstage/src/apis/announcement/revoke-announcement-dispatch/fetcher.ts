import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getAnnouncementControllerRevokeUrl } from '@/shared/api-sdk';
import type { AnnouncementDispatch } from '@/shared/api-sdk';

export const fetchAnnouncementDispatchRevokeMutation = defineAuthFetcher<
  HttpRequestDTO<{ announcementId: string; dispatchId: string }>,
  AnnouncementDispatch
>((http, request) =>
  http.request(
    getAnnouncementControllerRevokeUrl({
      id: request.params.announcementId,
      dispatchId: request.params.dispatchId,
    }),
    { method: 'POST' },
  ),
);
