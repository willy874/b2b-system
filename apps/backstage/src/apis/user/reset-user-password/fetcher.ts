import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getUserControllerResetPasswordUrl } from '@/shared/api-sdk';

export const fetchUserResetPasswordMutation = defineAuthFetcher<
  HttpRequestDTO<{
    userId: string;
    /**
     * 對象還沒啟用（`pending`）：後端改寄啟用信（docs/architecture/backend/13-trash.md 的「啟用／重設連結」）。
     * 不送給後端，只讓畫面選對的文字。
     */
    pending?: boolean;
  }>,
  { sent: boolean }
>((http, request) =>
  http.request(getUserControllerResetPasswordUrl({ id: request.params.userId }), {
    method: 'POST',
  }),
);
