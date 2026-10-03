import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { PlatformAdminListRoute } from '../../routes';

/** 列表的關鍵字放在網址。 */
export function usePlatformAdminSearchFilter() {
  const search = PlatformAdminListRoute.useSearch();
  const navigate = useNavigate({ from: PlatformAdminListRoute.fullPath });

  const setKeyword = useCallback(
    (keyword: string | undefined) => {
      void navigate({
        to: PlatformAdminListRoute.to,
        search: { ...search, keyword: keyword || undefined },
      });
    },
    [navigate, search],
  );

  return { search, setKeyword };
}
