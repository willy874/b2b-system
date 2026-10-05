import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

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
