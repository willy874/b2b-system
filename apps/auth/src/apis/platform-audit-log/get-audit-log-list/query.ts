import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { HttpRequestDTO } from '@/core/client';

import type { PlatformAuditLogListParams } from '../types';
import { fetchPlatformAuditLogListQuery } from './fetcher';

export const PLATFORM_AUDIT_LOG_LIST_QUERY_KEY = 'PLATFORM_AUDIT_LOG_LIST_QUERY_KEY';

const getPlatformAuditLogListQueryKeys = (params: PlatformAuditLogListParams) =>
  [
    PLATFORM_AUDIT_LOG_LIST_QUERY_KEY,
    params.offset,
    params.limit,
    params.action,
    params.actorEmail,
    params.resourceId,
    params.result,
    params.from,
    params.to,
  ] as const;

/** 平台稽核（`platformAuditLog:read`）；固定依發生時間新到舊，伺服器分頁。 */
export const getPlatformAuditLogListQueryOptions = (
  options: HttpRequestDTO<PlatformAuditLogListParams>,
) =>
  queryOptions({
    queryKey: getPlatformAuditLogListQueryKeys(options.params),
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchPlatformAuditLogListQuery({ params: options.params, signal }),
  });
