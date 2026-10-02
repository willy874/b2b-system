import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
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
