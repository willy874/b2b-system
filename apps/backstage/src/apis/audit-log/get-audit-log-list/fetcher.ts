import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

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
