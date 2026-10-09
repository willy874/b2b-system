import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformMfaMethodControllerSaveSettingsUrl } from '@/shared/api-sdk';
import type { MfaMethodSettings, UpdateMfaMethodSettingsRequest } from '@/shared/api-sdk';

/**
 * 儲存方式的平台參數：伺服器檢查必填、格式並以金鑰呼叫供應商，全部通過才寫入
 * （`400 MFA_METHOD_SETTINGS_CHECK_FAILED`、`VALIDATION_FAILED` 帶欄位的原因）。
 */
export const fetchSaveMfaMethodSettingsMutation = defineAuthFetcher<
  HttpRequestDTO<UpdateMfaMethodSettingsRequest & { id: string }>,
  MfaMethodSettings
>((http, { params: { id, ...body } }) =>
  http.request(
    getPlatformMfaMethodControllerSaveSettingsUrl({ id }),
    jsonBody(body, { method: 'PUT' }),
  ),
);
