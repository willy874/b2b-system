import { useTranslation } from '@b2b-system/web-core/locales';
import type { ReactNode } from 'react';

/** 頁首：標題、說明，右側是對目前資料夾的動作（`FileActions`）。 */
export function FileManagerHeader({ actions }: { actions: ReactNode }) {
  const { t } = useTranslation();
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="m-0 text-xl font-semibold">{t('file.title')}</h1>
        <p className="mt-1 mb-0 text-sm text-[var(--color-fg-muted)]">{t('file.description')}</p>
      </div>
      {actions}
    </header>
  );
}
