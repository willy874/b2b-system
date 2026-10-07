import { queryOptions } from '@tanstack/react-query';

import type { ImportMode } from '../types';
import { fetchImportColumnsQuery } from './fetcher';

export const DATA_TRANSFER_IMPORT_COLUMNS_QUERY_KEY = 'DATA_TRANSFER_IMPORT_COLUMNS_QUERY_KEY';

export const getImportColumnsQueryKeys = (type: string, mode: ImportMode) =>
  [DATA_TRANSFER_IMPORT_COLUMNS_QUERY_KEY, type, mode] as const;

export const getImportColumnsQueryOptions = (type: string, mode: ImportMode) =>
  queryOptions({
    queryKey: getImportColumnsQueryKeys(type, mode),
    queryFn: ({ signal }) => fetchImportColumnsQuery({ params: { type, mode }, signal }),
  });
