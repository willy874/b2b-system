import { Skeleton } from '@b2b-system/ui/Skeleton';
import { Suspense } from 'react';

import { useTranslation } from '../locales';
import { usePreferenceSections } from './hooks';

/**
 * 偏好頁底下由 feature 或 web-core（`table-column-settings`）登記的分頁（依 `order`），兩個 app 的偏好頁共用。
 *
 * 分頁元件以 `lazy()` 登記：只有偏好頁會渲染它們，登記本體會把分頁用到的套件（例：`TableSettings` 的 dnd-kit）
 * 帶進首屏（docs/architecture/frontend/02-plugin-system.md §4.3）。每個分頁各包一層 `<Suspense>`，
 * 下載中的分頁顯示骨架，其他分頁照常顯示。
 */
export function PreferenceSections() {
  const { t } = useTranslation();
  const sections = usePreferenceSections();
  return sections.map((section) => (
    <section key={section.key} data-testid="preference-section" data-value={section.key}>
      <h2 className="mb-2 text-base font-medium">{t(section.labelI18nKey)}</h2>
      <Suspense fallback={<Skeleton height={120} data-testid="preference-section-skeleton" />}>
        <section.Component />
      </Suspense>
    </section>
  ));
}
