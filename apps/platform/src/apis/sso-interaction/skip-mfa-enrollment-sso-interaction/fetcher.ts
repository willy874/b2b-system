import { defineBaseFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getMfaInteractionControllerSkipEnrollmentUrl } from '@/shared/api-sdk';
import type { SsoRedirect } from '@/shared/api-sdk';

/** 產品要求新增的驗證方式（docs/architecture/backend/21-mfa.md §7.1）：略過，照常完成登入。 */
export const fetchSkipMfaEnrollmentSsoInteractionMutation = defineBaseFetcher<
  HttpRequestDTO<{ uid: string }>,
  SsoRedirect
>((http, { params }) =>
  http.request(getMfaInteractionControllerSkipEnrollmentUrl({ uid: params.uid }), {
    method: 'POST',
  }),
);
