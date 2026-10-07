import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getDataTransferControllerReferenceOptionsUrl } from '@/shared/api-sdk';
import type { DataTransferReferenceOptionList } from '@/shared/api-sdk';

export const fetchImportOptions = defineAuthFetcher<
  HttpRequestDTO<{ type: string; column: string; keyword: string }>,
  DataTransferReferenceOptionList
>((http, { params }) =>
  http.request(
    withQuery(
      getDataTransferControllerReferenceOptionsUrl({ type: params.type, key: params.column }),
      {
        keyword: params.keyword,
      },
    ),
    { method: 'GET' },
  ),
);
