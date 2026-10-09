import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getUserIdentityControllerUnlinkUrl } from '@/shared/api-sdk';

/** 解除一個外部身分的連結；之後那個外部身分登入時重新對應帳號。 */
export const fetchUnlinkUserIdentityMutation = defineAuthFetcher<
  HttpRequestDTO<{ userId: string; identityId: string }>,
  undefined
>((http, { params }) =>
  http.request(
    getUserIdentityControllerUnlinkUrl({ userId: params.userId, identityId: params.identityId }),
    { method: 'DELETE' },
  ),
);
