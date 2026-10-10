import { useRouteSearch } from '@b2b-system/web-core/router';

import type { TrashTypeRegistration } from '@/core/trash';

import { TrashListRoute } from '../../routes';
import type { TrashSearchQuery } from '../../routes';

/**
 * 分頁（類型）與換頁都放在網址。網址上的類型不存在或看不到時，改看第一個看得到的類型
 * （直接貼網址、或權限剛被收回）。
 */
export function useTrashSearch(types: readonly TrashTypeRegistration[]) {
  const { search, patch } = useRouteSearch<TrashSearchQuery>(TrashListRoute);
  const active = types.find((type) => type.type === search.type) ?? types[0];

  return {
    search,
    active,
    /** 換類型回到第一頁。 */
    setType: (type: string) => patch({ type, offset: 0 }),
    setPage: (offset: number, limit: number) => patch({ offset, limit }),
  };
}
