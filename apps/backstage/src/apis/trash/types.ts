import type { TrashResourceType } from '@/shared/api-sdk';

/** 後端 `ListTrashSchema`：一次只列一種類型。 */
export interface TrashListParams {
  type: TrashResourceType;
  offset: number;
  limit: number;
  keyword?: string;
}
