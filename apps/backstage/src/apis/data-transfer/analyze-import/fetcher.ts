import { defineAuthFetcher } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getDataTransferControllerAnalyzeUrl } from '@/shared/api-sdk';
import type { DataTransferImportAnalysis } from '@/shared/api-sdk';

import type { ImportMode } from '../types';

export interface AnalyzeImportParams {
  type: string;
  file: File;
  mode: ImportMode;
  encoding: 'auto' | 'utf-8' | 'big5' | 'utf-16';
  sheet?: string;
  mapping?: Record<number, string | null>;
}

/**
 * 分析：這個 app 第一個 multipart 的 fetcher（docs/architecture/backend/22-data-transfer.md §7.3）。
 * 不設 Content-Type：瀏覽器替 FormData 帶上 boundary。
 */
export const fetchAnalyzeImport = defineAuthFetcher<
  HttpRequestDTO<AnalyzeImportParams>,
  DataTransferImportAnalysis
>((http, { params }) => {
  const form = new FormData();
  form.append('mode', params.mode);
  form.append('encoding', params.encoding);
  if (params.sheet) form.append('sheet', params.sheet);
  if (params.mapping) form.append('mapping', JSON.stringify(params.mapping));
  // 檔案放最後：後端讀到檔案時文字欄位都已經到了
  form.append('file', params.file, params.file.name);
  return http.request(getDataTransferControllerAnalyzeUrl({ type: params.type }), {
    method: 'POST',
    body: form,
  });
});
