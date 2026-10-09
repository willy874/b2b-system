import { Skeleton } from '@b2b-system/ui/Skeleton';
import { i18n, loadLocaleScope } from '@b2b-system/web-core/locales';
import { usePageAccessChecker } from '@b2b-system/web-core/permission';
import { useStore } from '@b2b-system/web-shared/hooks';
import { Suspense, useEffect, useMemo } from 'react';

import { homeSectionRegistry } from './registry';

/**
 * 首頁放 feature 區塊的位置（docs/architecture/frontend/02-plugin-system.md §4.7）：依 `order` 列出有權限的區塊，
 * 每個區塊各包一層 `<Suspense>`。區塊的語系包在掛上時載入。權限未水合前不渲染。
 */
export function HomeSections() {
  const entries = useStore(homeSectionRegistry.store, (state) => state.entries);
  const { hydrated, canAccessPage } = usePageAccessChecker();
  const sections = useMemo(
    () =>
      hydrated
        ? [...entries.values()]
            .filter((section) => canAccessPage(section.pageKey))
            .toSorted((a, b) => a.order - b.order)
        : [],
    [canAccessPage, entries, hydrated],
  );
  useEffect(() => {
    for (const { localeScope } of sections) {
      // 失敗時不記成已載入，下一次掛上時重試；畫面暫時顯示 key
      if (localeScope) loadLocaleScope(localeScope, i18n.language).catch(() => undefined);
    }
  }, [sections]);

  return sections.map(({ key, Section }) => (
    <Suspense key={key} fallback={<Skeleton height={120} data-testid="home-section-skeleton" />}>
      <Section />
    </Suspense>
  ));
}
