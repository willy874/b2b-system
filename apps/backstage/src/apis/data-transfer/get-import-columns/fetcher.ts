import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getDataTransferControllerImportColumnsUrl } from '@/shared/api-sdk';
import type { DataTransferImportColumnList } from '@/shared/api-sdk';

import type { ImportMode } from '../types';

export const fetchImportColumnsQuery = defineAuthFetcher<
  HttpRequestDTO<{ type: string; mode: ImportMode }>,
  DataTransferImportColumnList
>((http, { params }) =>
  http.request(
    withQuery(getDataTransferControllerImportColumnsUrl({ type: params.type }), {
      mode: params.mode,
    }),
    {
      method: 'GET',
    },
  ),
);
