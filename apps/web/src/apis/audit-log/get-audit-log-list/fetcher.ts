import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAuditLogControllerListUrl } from '@/shared/api-sdk';
import type { AuditLogControllerList200Data } from '@/shared/api-sdk';

import type { AuditLogListParams } from '../types';

export const fetchAuditLogListQuery = defineAuthFetcher<
  HttpRequestDTO<AuditLogListParams>,
  AuditLogControllerList200Data
>((http, request) =>
  http.request(withQuery(getAuditLogControllerListUrl(), { ...request.params }), {
    method: 'GET',
    signal: request.signal,
  }),
);
