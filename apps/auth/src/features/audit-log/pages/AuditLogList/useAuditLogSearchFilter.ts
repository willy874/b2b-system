import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { AuditLogListRoute } from '../../routes';
import type { AuditLogSearchQuery } from '../../routes';

/** 列表的分頁與篩選全部放在網址；改篩選條件時回到第一頁。 */
export function useAuditLogSearchFilter() {
  const search = AuditLogListRoute.useSearch();
  const navigate = useNavigate();

  const patch = useCallback(
    (next: Partial<AuditLogSearchQuery>) => {
      void navigate({ to: AuditLogListRoute.to, search: { ...search, ...next } });
    },
    [navigate, search],
  );

  return {
    search,
    setFilter: (filter: Partial<Omit<AuditLogSearchQuery, 'offset' | 'limit'>>) =>
      patch({ ...filter, offset: 0 }),
    setPage: (offset: number, limit: number) => patch({ offset, limit }),
  };
}
