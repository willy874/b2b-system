import { useTranslation } from '@b2b-system/web-core/locales';

/**
 * 審批列表的空狀態說明申請從哪裡來（docs/architecture/backend/20-approval.md §11.2）：審核者第一次看到空的列表時，
 * 知道它不是壞掉，而是還沒有人送出申請。
 */
export function ApprovalSourcesHint() {
  const { t } = useTranslation();
  return (
    <span className="flex flex-col gap-1" data-testid="approval-sources-hint">
      <span>{t('approval.sources.title')}</span>
      <span>{t('approval.sources.register')}</span>
      <span>{t('approval.sources.folderAccess')}</span>
    </span>
  );
}
