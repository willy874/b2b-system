import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getPlatformCdnControllerUpdateUrl } from '@/shared/api-sdk';
import type { CdnOverview, UpdateCdnSettingsRequest } from '@/shared/api-sdk';

/**
 * 執行期的開關與參數：只帶要改的欄位與 `version`，`null` 回到跟著環境變數。開啟或加入資源類型前伺服器先檢查節點
 * （`409 CDN_NOT_READY`，`details.nodes`）；版本不符 `409 CDN_SETTINGS_VERSION_CONFLICT`。
 */
export const fetchUpdateCdnSettingsMutation = defineAuthFetcher<
  HttpRequestDTO<UpdateCdnSettingsRequest>,
  CdnOverview
>((http, { params }) =>
  http.request(getPlatformCdnControllerUpdateUrl(), jsonBody(params, { method: 'PUT' })),
);
