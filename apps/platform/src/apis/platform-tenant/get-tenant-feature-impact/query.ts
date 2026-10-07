import { queryOptions } from '@tanstack/react-query';

import type { TenantFeature } from '@/shared/api-sdk';

import { fetchTenantFeatureImpactQuery } from './fetcher';

export const TENANT_FEATURE_IMPACT_QUERY_KEY = 'TENANT_FEATURE_IMPACT_QUERY_KEY';

/**
 * 關閉 feature 會影響的數量（關閉前的確認框）。每次打開確認框都重新計算：數字要反映當下，不沿用快取。
 */
export const getTenantFeatureImpactQueryOptions = (id: string, feature: TenantFeature) =>
  queryOptions({
    queryKey: [TENANT_FEATURE_IMPACT_QUERY_KEY, id, feature] as const,
    queryFn: ({ signal }) => fetchTenantFeatureImpactQuery({ params: { id, feature }, signal }),
    staleTime: 0,
    gcTime: 0,
  });
