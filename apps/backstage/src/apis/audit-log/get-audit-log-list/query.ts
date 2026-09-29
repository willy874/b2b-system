import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { HttpRequestDTO } from '@/core/client';

import type { AuditLogListParams } from '../types';
import { fetchAuditLogListQuery } from './fetcher';

export const AUDIT_LOG_LIST_QUERY_KEY = 'AUDIT_LOG_LIST_QUERY_KEY';

const getAuditLogListQueryKeys = (params: AuditLogListParams) =>
  [
    AUDIT_LOG_LIST_QUERY_KEY,
    params.offset,
    params.limit,
    params.actorId,
    params.action,
    params.resourceType,
    params.resourceId,
    params.result,
    params.from,
    params.to,
  ] as const;

export const getAuditLogListQueryOptions = (options: HttpRequestDTO<AuditLogListParams>) =>
  queryOptions({
    queryKey: getAuditLogListQueryKeys(options.params),
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchAuditLogListQuery({ params: options.params, signal }),
  });
