import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getAnnouncementControllerListUrl } from '@/shared/api-sdk';
import type { AnnouncementControllerListResponse } from '@/shared/api-sdk';

import type { AnnouncementListParams } from '../types';

export const fetchAnnouncementListQuery = defineAuthFetcher<
  HttpRequestDTO<AnnouncementListParams>,
  AnnouncementControllerListResponse['data']
>((http, request) =>
  http.request(withQuery(getAnnouncementControllerListUrl(), { ...request.params }), {
    method: 'GET',
  }),
);
