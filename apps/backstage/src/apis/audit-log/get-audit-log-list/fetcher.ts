import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getAuditLogControllerListUrl } from '@/shared/api-sdk';
import type { AuditLogControllerListResponse } from '@/shared/api-sdk';

import type { AuditLogListParams } from '../types';

export const fetchAuditLogListQuery = defineAuthFetcher<
  HttpRequestDTO<AuditLogListParams>,
  AuditLogControllerListResponse['data']
>((http, request) => {
  // 游標與 offset 不能同時帶（api 回 400）：有游標就不送 offset
  const { cursor, offset, ...filters } = request.params;
  return http.request(
    withQuery(
      getAuditLogControllerListUrl(),
      cursor ? { ...filters, cursor } : { ...filters, offset },
    ),
    { method: 'GET' },
  );
});
