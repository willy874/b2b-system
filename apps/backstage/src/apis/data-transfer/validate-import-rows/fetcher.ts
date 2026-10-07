import { defineAuthFetcher, jsonBody } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getDataTransferControllerValidateUrl } from '@/shared/api-sdk';
import type { ValidateImportRequest, ValidateImportResult } from '@/shared/api-sdk';

export const fetchValidateImportRows = defineAuthFetcher<
  HttpRequestDTO<{ type: string } & ValidateImportRequest>,
  ValidateImportResult
>((http, { params: { type, ...body } }) =>
  http.request(getDataTransferControllerValidateUrl({ type }), jsonBody(body, { method: 'POST' })),
);
