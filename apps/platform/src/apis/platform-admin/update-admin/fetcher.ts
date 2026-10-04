import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getPlatformAdminControllerUpdateUrl } from '@/shared/api-sdk';
import type { PlatformAdmin, UpdatePlatformAdminRequest } from '@/shared/api-sdk';

/** 改名、換角色、停用／啟用（locked 改回 active 即解鎖）。 */
export const fetchUpdateAdminMutation = defineAuthFetcher<
  HttpRequestDTO<{ id: string; body: UpdatePlatformAdminRequest }>,
  PlatformAdmin
>((http, request) =>
  http.request(
    getPlatformAdminControllerUpdateUrl({ id: request.params.id }),
    jsonBody(request.params.body, { method: 'PATCH' }),
  ),
);
