import { defineAuthFetcher } from '@/core/client';
import { getAuthControllerLogoutUrl } from '@/shared/api-sdk';

export const fetchLogoutMutation = defineAuthFetcher<void, { success: boolean }>((http) =>
  http.request(getAuthControllerLogoutUrl(), { method: 'POST', credentials: 'same-origin' }),
);
