import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

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
