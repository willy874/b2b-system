import type { SortEntry } from '@/shared/constants';

/** 後端 `ListServiceAccountSchema` 的排序白名單。 */
export type ServiceAccountSortField = 'createdAt' | 'name';

export interface ServiceAccountListParams {
  offset: number;
  limit: number;
  keyword?: string;
  sort?: Array<SortEntry<ServiceAccountSortField>>;
}
