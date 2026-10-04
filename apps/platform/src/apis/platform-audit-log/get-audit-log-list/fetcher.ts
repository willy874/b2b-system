import { defineAuthFetcher, withQuery } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformAdminControllerAuditLogsUrl } from '@/shared/api-sdk';
import type { PlatformAdminControllerAuditLogsResponse } from '@/shared/api-sdk';

import type { PlatformAuditLogListParams } from '../types';

export const fetchPlatformAuditLogListQuery = defineAuthFetcher<
  HttpRequestDTO<PlatformAuditLogListParams>,
  PlatformAdminControllerAuditLogsResponse['data']
>((http, request) =>
  http.request(withQuery(getPlatformAdminControllerAuditLogsUrl(), { ...request.params }), {
    method: 'GET',
  }),
);
