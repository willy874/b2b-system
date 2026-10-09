import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformMfaMethodControllerClearSettingsUrl } from '@/shared/api-sdk';
import type { MfaMethodSettings } from '@/shared/api-sdk';

/** 刪除方式的平台參數；方式還開著時回 `409 MFA_METHOD_SETTINGS_IN_USE`。 */
export const fetchClearMfaMethodSettingsMutation = defineAuthFetcher<
  HttpRequestDTO<{ id: string }>,
  MfaMethodSettings
>((http, { params }) =>
  http.request(getPlatformMfaMethodControllerClearSettingsUrl({ id: params.id }), {
    method: 'DELETE',
  }),
);
