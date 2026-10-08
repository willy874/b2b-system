import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getDataTransferControllerTargetOptionsUrl } from '@/shared/api-sdk';
import type { DataTransferTargetOptionList } from '@/shared/api-sdk';

/** 修改模式：手動指定比對目標的下拉選單（docs/architecture/backend/22-data-transfer.md §7.5）。 */
export const fetchImportTargets = defineAuthFetcher<
  HttpRequestDTO<{ type: string; keyword: string }>,
  DataTransferTargetOptionList
>((http, { params }) =>
  http.request(
    withQuery(getDataTransferControllerTargetOptionsUrl({ type: params.type }), {
      keyword: params.keyword,
    }),
    { method: 'GET' },
  ),
);
