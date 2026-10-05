import { useTranslation } from '@b2b-system/web-core/locales';

/** 頁首：標題、說明、目前資料夾的檔案總數。 */
export function FileManagerHeader({ total }: { total: number }) {
  const { t } = useTranslation();
  return (
    <header className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="m-0 text-xl font-semibold">{t('file.title')}</h1>
        <p className="mt-1 mb-0 text-sm text-[var(--color-fg-muted)]">{t('file.description')}</p>
      </div>
      <span className="text-sm text-[var(--color-fg-muted)]" data-testid="file-total">
        {t('file.total', { count: total })}
      </span>
    </header>
  );
}
