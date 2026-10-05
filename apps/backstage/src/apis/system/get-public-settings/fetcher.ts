import { defineBaseFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getSystemSettingControllerListPublicUrl } from '@/shared/api-sdk';
import type { PublicSystemSettings } from '@/shared/api-sdk';

/** 公開端點：登入前就會呼叫，用 base 版（不取 access token）。 */
export const fetchPublicSettingsQuery = defineBaseFetcher<
  HttpRequestDTO<void>,
  PublicSystemSettings
>((http) => http.request(getSystemSettingControllerListPublicUrl(), { method: 'GET' }));
