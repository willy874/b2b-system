import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getUserControllerReplaceRolesUrl } from '@/shared/api-sdk';
import type { ReplaceUserRolesRequest, UserRoles } from '@/shared/api-sdk';

/** PUT：整批取代語意（UI 是一個多選器，送出的是最終狀態）。 */
export const fetchAssignUserRolesMutation = defineAuthFetcher<
  HttpRequestDTO<{ userId: string; body: ReplaceUserRolesRequest }>,
  UserRoles
>((http, request) =>
  http.request(
    getUserControllerReplaceRolesUrl({ id: request.params.userId }),
    jsonBody(request.params.body, { method: 'PUT' }),
  ),
);
