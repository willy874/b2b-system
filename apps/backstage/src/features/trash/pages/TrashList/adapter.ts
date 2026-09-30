import type { TrashItem } from '@/shared/api-sdk';
import { formatDateTime } from '@/shared/date';

export interface TrashRowVM {
  item: TrashItem;
  id: string;
  name: string;
  description: string;
  deletedAt: string;
  /** 刪除者的名稱；系統刪除或已不存在時是 `-`。 */
  deletedBy: string;
  purgeAt: string;
}

export function toTrashRowVM(item: TrashItem): TrashRowVM {
  return {
    item,
    id: item.id,
    name: item.name,
    description: item.description ?? '',
    deletedAt: formatDateTime(item.deletedAt),
    deletedBy: item.deletedBy?.name ?? '-',
    purgeAt: formatDateTime(item.purgeAt),
  };
}
