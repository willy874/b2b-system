import { useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';

import { ENV } from '@/shared/constants';

/**
 * 平台的租戶（工作區）管理搬到 apps/auth 了（docs/adr/0019-sso-identity-platform.md D13）。
 * 接住舊網址與書籤，連同查詢字串頂層跳轉過去；保留一版後移除（docs/architecture/04-sso.md §6.1）。
 */
export default function WorkspaceAdminMovedPage() {
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });

  useEffect(() => {
    globalThis.location.replace(`${ENV.AUTH_APP_URL}/workspaces${searchStr}`);
  }, [searchStr]);

  return null;
}
