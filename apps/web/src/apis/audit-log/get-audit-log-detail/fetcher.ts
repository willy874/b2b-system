import { defineAuthFetcher } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAuditLogControllerFindOneUrl } from '@/shared/api-sdk';
import type { AuditLog } from '@/shared/api-sdk';

export const fetchAuditLogDetailQuery = defineAuthFetcher<HttpRequestDTO<{ id: string }>, AuditLog>(
  (http, request) =>
    http.request(getAuditLogControllerFindOneUrl(request.params.id), {
      method: 'GET',
    }),
);
