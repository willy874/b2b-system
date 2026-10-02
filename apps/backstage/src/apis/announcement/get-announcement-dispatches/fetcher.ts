import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAnnouncementControllerListDispatchesUrl } from '@/shared/api-sdk';
import type { AnnouncementControllerListDispatchesResponse } from '@/shared/api-sdk';

import type { AnnouncementDispatchListParams } from '../types';

export const fetchAnnouncementDispatchesQuery = defineAuthFetcher<
  HttpRequestDTO<AnnouncementDispatchListParams>,
  AnnouncementControllerListDispatchesResponse['data']
>((http, request) => {
  const { announcementId, ...query } = request.params;
  return http.request(
    withQuery(getAnnouncementControllerListDispatchesUrl({ id: announcementId }), query),
    { method: 'GET' },
  );
});
