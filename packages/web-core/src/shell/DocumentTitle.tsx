import { useRouterState } from '@tanstack/react-router';
import type { AnyRouter } from '@tanstack/react-router';
import { useEffect } from 'react';

import { i18n, useTranslation } from '../locales';
import { findTitleKey } from '../router';

export interface DocumentTitleProps {
  /** app 的 router：與 `SessionWatcher` 一樣放在 `RouterProvider` 之外，以參數傳入。 */
  router: AnyRouter;
  /** 產品名的語系鍵（標題的後半）。 */
  appNameKey: string;
}

/**
 * 換頁與換語系時更新 `document.title`：「頁面 · 產品名」，頁面名取自路由的 `staticData.titleKey`
 * （docs/architecture/frontend/08-i18n.md §5）。多個分頁的標題才分得出來，英文介面也不會留著中文標題。
 * 頁面的語系包還沒載入（或路由沒有標題）時只顯示產品名，不顯示原始 key。
 */
export function DocumentTitle({ router, appNameKey }: DocumentTitleProps) {
  const { t } = useTranslation();
  const titleKey = useRouterState({ router, select: (state) => findTitleKey(state.matches) });

  useEffect(() => {
    const app = t(appNameKey);
    const page = titleKey && i18n.exists(titleKey) ? t(titleKey) : undefined;
    document.title = page ? `${page} · ${app}` : app;
  }, [appNameKey, t, titleKey]);

  return null;
}
