import { defineBaseFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getSystemSettingControllerListPublicUrl } from '@/shared/api-sdk';
import type { PublicSystemSettings } from '@/shared/api-sdk';

import { tenantHeaders } from '../tenant';
import type { TenantScoped } from '../tenant';

/** 租戶的公開設定（是否開放註冊、密碼長度）；未登入即可呼叫，以 `X-Tenant` 指定租戶。 */
export const fetchPublicSettingsQuery = defineBaseFetcher<
  HttpRequestDTO<TenantScoped>,
  PublicSystemSettings
>((http, request) =>
  http.request(getSystemSettingControllerListPublicUrl(), {
    method: 'GET',
    headers: tenantHeaders(request.params.tenant),
  }),
);
