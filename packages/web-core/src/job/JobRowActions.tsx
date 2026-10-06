import { IconButton } from '@b2b-system/ui/Button';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { Icon } from '@b2b-system/ui/Icon';
import { Tooltip } from '@b2b-system/ui/Tooltip';

import { useErrorToast } from '../errors';
import { useTranslation } from '../locales';
import type { JobRowVM } from './types';

export interface JobRowActionsProps {
  row: JobRowVM;
  isExpanded: boolean;
  onToggleExpand: (id: string) => void;
  /** 重試一筆工作（app 的 retry mutation 的 `mutateAsync`）；失敗時 reject。 */
  onRetry: (id: string) => Promise<unknown>;
}

/** 列上的操作：展開明細；`row.canRetry`（失敗且有重試的權限）時可以重試（先確認）。 */
export function JobRowActions({ row, isExpanded, onToggleExpand, onRetry }: JobRowActionsProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const showError = useErrorToast();
  const expandLabel = isExpanded ? t('job.collapse') : t('job.expand');

  // 失敗時提示並重拋：確認框留著，讓使用者決定重試或取消
  const reportError = (error: unknown): never => {
    showError(error);
    throw error;
  };

  return (
    <div className="flex gap-1">
      {row.canRetry && (
        <Tooltip content={t('job.retry.action')}>
          <IconButton
            size="sm"
            aria-label={t('job.retry.action')}
            onClick={() =>
              void confirm({
                title: t('job.retry.title'),
                description: t('job.retry.confirm', { name: row.name }),
                confirmLabel: t('job.retry.action'),
                tone: 'primary',
                onConfirm: () => onRetry(row.id).catch(reportError),
              })
            }
            data-testid="job-retry"
            data-value={row.id}
          >
            <Icon name="redo" size={16} />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip content={expandLabel}>
        <IconButton
          size="sm"
          aria-label={expandLabel}
          aria-expanded={isExpanded}
          onClick={() => onToggleExpand(row.id)}
          data-testid="job-expand"
          data-value={row.id}
        >
          <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={16} />
        </IconButton>
      </Tooltip>
    </div>
  );
}
