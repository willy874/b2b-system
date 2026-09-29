import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useTranslation } from '@/core/locales';

interface FileLockedNoticeProps {
  /** 已經有一筆待審的申請。 */
  pending: boolean;
  onRequest: () => void;
}

/**
 * 目前所在的資料夾鎖住時（沒有 read）：主區塊上方說明看得到子資料夾、看不到檔案，並提供申請存取
 * （docs/architecture/frontend/12-file-manager.md §13）。
 */
export function FileLockedNotice({ pending, onRequest }: FileLockedNoticeProps) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-fill-subtle)] px-4 py-3"
      data-testid="file-locked-notice"
      data-value={pending ? 'pending' : 'locked'}
    >
      <Icon name="lock" size={20} className="shrink-0 text-[var(--color-fg-muted)]" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{t('file.access.lockedTitle')}</span>
        <span className="text-xs text-[var(--color-fg-muted)]">
          {pending ? t('file.access.pendingDescription') : t('file.access.lockedDescription')}
        </span>
      </div>
      {pending ? (
        <span className="text-sm text-[var(--color-fg-muted)]">{t('file.access.pending')}</span>
      ) : (
        <Button variant="primary" onClick={onRequest} data-testid="file-access-request-button">
          {t('file.access.request')}
        </Button>
      )}
    </div>
  );
}
