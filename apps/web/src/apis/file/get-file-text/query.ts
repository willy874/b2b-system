import { queryOptions } from '@tanstack/react-query';

import { fetchFileText } from './fetcher';

export const FILE_TEXT_QUERY_KEY = 'FILE_TEXT_QUERY_KEY';

/**
 * 檔案內容以 id 為 key、上傳後不可變，所以不必重抓（`staleTime: Infinity`）；
 * 網址只是取得內容的方式，不放進 key——網址換了（重新簽章）內容也一樣。
 */
export const getFileTextQueryOptions = (params: {
  fileId: string;
  url: string;
  maxBytes: number;
}) =>
  queryOptions({
    queryKey: [FILE_TEXT_QUERY_KEY, params.fileId, params.maxBytes] as const,
    queryFn: ({ signal }) => fetchFileText({ url: params.url, maxBytes: params.maxBytes }, signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
