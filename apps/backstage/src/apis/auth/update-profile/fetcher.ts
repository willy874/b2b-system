import { defineAuthFetcher, jsonBody } from '@/core/client';
import type { HttpRequestDTO } from '@/core/client';
import { getAuthControllerUpdateProfileUrl } from '@/shared/api-sdk';
import type { Profile, UpdateProfileRequest } from '@/shared/api-sdk';

export const fetchUpdateProfileMutation = defineAuthFetcher<
  HttpRequestDTO<UpdateProfileRequest>,
  Profile
>((http, request) =>
  http.request(getAuthControllerUpdateProfileUrl(), jsonBody(request.params, { method: 'PATCH' })),
);
