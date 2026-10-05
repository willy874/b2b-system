import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getAnnouncementControllerPreviewRecurrenceUrl } from '@/shared/api-sdk';
import type {
  AnnouncementRecurrencePreview,
  AnnouncementRecurrencePreviewRequest,
} from '@/shared/api-sdk';

export const fetchAnnouncementRecurrencePreviewQuery = defineAuthFetcher<
  HttpRequestDTO<AnnouncementRecurrencePreviewRequest>,
  AnnouncementRecurrencePreview
>((http, request) =>
  http.request(
    getAnnouncementControllerPreviewRecurrenceUrl(),
    jsonBody(request.params, { method: 'POST' }),
  ),
);
