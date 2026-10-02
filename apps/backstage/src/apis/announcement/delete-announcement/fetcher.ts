import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAnnouncementControllerRemoveUrl } from '@/shared/api-sdk';

export const fetchAnnouncementDeleteMutation = defineAuthFetcher<
  HttpRequestDTO<{ announcementId: string }>,
  undefined
>((http, request) =>
  http.request(getAnnouncementControllerRemoveUrl({ id: request.params.announcementId }), {
    method: 'DELETE',
  }),
);
