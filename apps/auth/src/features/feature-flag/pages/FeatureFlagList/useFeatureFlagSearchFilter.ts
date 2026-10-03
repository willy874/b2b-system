import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { FeatureFlagListRoute } from '../../routes';

/** 列表的關鍵字放在網址。 */
export function useFeatureFlagSearchFilter() {
  const search = FeatureFlagListRoute.useSearch();
  const navigate = useNavigate({ from: FeatureFlagListRoute.fullPath });

  const setKeyword = useCallback(
    (keyword: string | undefined) => {
      void navigate({
        to: FeatureFlagListRoute.to,
        search: { ...search, keyword: keyword || undefined },
      });
    },
    [navigate, search],
  );

  return { search, setKeyword };
}
