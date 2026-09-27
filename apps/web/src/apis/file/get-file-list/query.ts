import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { HttpRequestDTO } from '@/core/client';
import { toSortParams } from '@/shared/constants';

import type { FileListParams } from '../types';
import { fetchFileListQuery } from './fetcher';

export const FILE_LIST_QUERY_KEY = 'FILE_LIST_QUERY_KEY';

const getFileListQueryKeys = (params: FileListParams) =>
  [
    FILE_LIST_QUERY_KEY,
    params.offset,
    params.limit,
    params.keyword,
    params.contentType,
    params.sort ? toSortParams(params.sort).join(',') : '',
  ] as const;

export const getFileListQueryOptions = (options: HttpRequestDTO<FileListParams>) =>
  queryOptions({
    queryKey: getFileListQueryKeys(options.params),
    placeholderData: keepPreviousData, // 換頁時不閃空白
    queryFn: ({ signal }) => fetchFileListQuery({ params: options.params, signal }),
  });
