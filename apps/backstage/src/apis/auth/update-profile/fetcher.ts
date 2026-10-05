import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getAuthControllerUpdateProfileUrl } from '@/shared/api-sdk';
import type { Profile, UpdateProfileRequest } from '@/shared/api-sdk';

export const fetchUpdateProfileMutation = defineAuthFetcher<
  HttpRequestDTO<UpdateProfileRequest>,
  Profile
>((http, request) =>
  http.request(getAuthControllerUpdateProfileUrl(), jsonBody(request.params, { method: 'PATCH' })),
);
