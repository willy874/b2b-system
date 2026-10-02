import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { WebhookListRoute } from '../../routes';
import type { WebhookSearchQuery } from '../../routes';

/** 列表的分頁與關鍵字全部放在網址。 */
export function useWebhookSearchFilter() {
  const search = WebhookListRoute.useSearch();
  const navigate = useNavigate({ from: WebhookListRoute.fullPath });

  const patch = useCallback(
    (next: Partial<WebhookSearchQuery>) => {
      void navigate({ to: WebhookListRoute.to, search: { ...search, ...next } });
    },
    [navigate, search],
  );

  return {
    search,
    /** 改關鍵字就回到第一頁。 */
    setKeyword: (keyword: string | undefined) =>
      patch({ keyword: keyword || undefined, offset: 0 }),
    setPage: (offset: number, limit: number) => patch({ offset, limit }),
  };
}
