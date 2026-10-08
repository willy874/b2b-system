import { Skeleton } from '@b2b-system/ui/Skeleton';
import { i18n, loadLocaleScope } from '@b2b-system/web-core/locales';
import { useStore } from '@b2b-system/web-shared/hooks';
import { Suspense, useEffect, useMemo } from 'react';

import { resourcePanelRegistry } from './registry';
import type { ResourcePanelProps } from './registry';

/**
 * 資源頁面上放通用面板的位置（docs/architecture/frontend/22-comment.md §2）：依 `order` 列出適用於這個資源類型的面板，
 * 每個面板各包一層 `<Suspense>`（下載中顯示骨架）。面板的語系包在掛上時載入，載入後 `useTranslation` 讓面板重渲染。
 * 沒有任何面板時不渲染東西。
 */
export function ResourcePanels({ resourceType, resourceId }: ResourcePanelProps) {
  const entries = useStore(resourcePanelRegistry.store, (state) => state.entries);
  const panels = useMemo(
    () =>
      [...entries.values()]
        .filter((panel) => panel.resourceTypes.includes(resourceType))
        .toSorted((a, b) => a.order - b.order),
    [entries, resourceType],
  );
  useEffect(() => {
    for (const { localeScope } of panels) {
      // 失敗時不記成已載入，下一次掛上時重試；畫面暫時顯示 key
      if (localeScope) loadLocaleScope(localeScope, i18n.language).catch(() => undefined);
    }
  }, [panels]);

  return panels.map(({ id, Panel }) => (
    <Suspense key={id} fallback={<Skeleton height={120} data-testid="resource-panel-skeleton" />}>
      <Panel resourceType={resourceType} resourceId={resourceId} />
    </Suspense>
  ));
}
