import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAuditLogControllerListUrl } from '@/shared/api-sdk';
import type { AuditLogControllerListResponse } from '@/shared/api-sdk';

import type { AuditLogListParams } from '../types';

export const fetchAuditLogListQuery = defineAuthFetcher<
  HttpRequestDTO<AuditLogListParams>,
  AuditLogControllerListResponse['data']
>((http, request) =>
  http.request(withQuery(getAuditLogControllerListUrl(), { ...request.params }), {
    method: 'GET',
  }),
);
