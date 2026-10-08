import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getDataTransferControllerTemplateUrl } from '@/shared/api-sdk';

import { fileNameOf } from '../types';
import type { DownloadedFile, ImportFormat, ImportMode } from '../types';

/** 匯入範本（附件，HTTP 管道回 Blob）。 */
export const fetchImportTemplate = defineAuthFetcher<
  HttpRequestDTO<{ type: string; mode: ImportMode; format: ImportFormat }>,
  DownloadedFile
>(async (http, { params: { type, ...query } }) => {
  const response = await http.request<Blob>(
    withQuery(getDataTransferControllerTemplateUrl({ type }), { ...query }),
    { method: 'GET' },
  );
  return {
    ...response,
    data: {
      blob: response.data,
      fileName: fileNameOf(response.headers, `template.${query.format}`),
    },
  };
});
