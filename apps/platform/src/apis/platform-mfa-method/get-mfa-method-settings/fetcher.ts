import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformMfaMethodControllerGetSettingsUrl } from '@/shared/api-sdk';
import type { MfaMethodSettings } from '@/shared/api-sdk';

/** 方式的平台參數（docs/architecture/backend/21-mfa.md §5.1）：機密欄位只回傳有沒有設定。 */
export const fetchMfaMethodSettingsQuery = defineAuthFetcher<
  HttpRequestDTO<{ id: string }>,
  MfaMethodSettings
>((http, { params }) =>
  http.request(getPlatformMfaMethodControllerGetSettingsUrl({ id: params.id }), { method: 'GET' }),
);
