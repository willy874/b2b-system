import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAnnouncementControllerPreviewAudienceUrl } from '@/shared/api-sdk';
import type { AnnouncementAudience, AnnouncementAudiencePreview } from '@/shared/api-sdk';

export const fetchAnnouncementAudiencePreviewQuery = defineAuthFetcher<
  HttpRequestDTO<AnnouncementAudience>,
  AnnouncementAudiencePreview
>((http, request) =>
  http.request(
    getAnnouncementControllerPreviewAudienceUrl(),
    jsonBody(request.params, { method: 'POST' }),
  ),
);
