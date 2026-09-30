import { Button } from '@/components/Button';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { cn } from '@/shared/utils';

export interface VersionConflictAlertProps {
  /** 樂觀鎖衝突的錯誤（`isVersionConflict(error)`）；訊息取自 `error.<CODE>`。 */
  error: unknown;
  /** 放棄這次的修改、改成最新的內容（通常是重抓資料並重設表單）。 */
  onReload: () => void;
  /** 重新載入進行中。 */
  reloading?: boolean;
  className?: string;
  'data-testid'?: string;
}

/**
 * 編輯表單送出時遇到樂觀鎖衝突（409 `<RESOURCE>_VERSION_CONFLICT`）：說明內容已被別人修改，
 * 提供「重新載入」。表單與輸入留著，使用者可以先把自己的修改記下來再載入
 * （docs/architecture/backend/03-api-conventions.md §11）。
 */
export function VersionConflictAlert({
  error,
  onReload,
  reloading,
  className,
  'data-testid': testId = 'version-conflict-alert',
}: VersionConflictAlertProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start justify-between gap-3 rounded border border-[var(--color-warning)] bg-[var(--color-fill-subtle)] p-3 text-sm',
        className,
      )}
      data-testid={testId}
    >
      <div className="flex flex-col gap-1">
        <p className="m-0 text-[var(--color-warning-text)]">{toMessage(error)}</p>
        <p className="m-0 text-xs text-[var(--color-fg-muted)]">
          {t('common.versionConflict.hint')}
        </p>
      </div>
      <Button
        size="sm"
        loading={reloading}
        onClick={onReload}
        data-testid="version-conflict-reload"
      >
        {t('common.versionConflict.reload')}
      </Button>
    </div>
  );
}
