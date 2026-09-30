import { useCallback } from 'react';

import { Button } from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import type { TableSelection } from '@/components/Table';
import { BatchActionBar } from '@/components/Table';
import { Tooltip } from '@/components/Tooltip';
import {
  BatchProgressBar,
  isBatchJobActive,
  isGoneError,
  useBatchJobFinished,
  useBatchJobs,
  useBatchQueue,
} from '@/core/batch';
import type { BatchAction, BatchTargets } from '@/core/batch';
import { useTranslation } from '@/core/locales';

/** `RichTable` 的批次操作（docs/architecture/frontend/07-ui-system.md §6.2）。 */
export interface RichTableBatch<TData> {
  /**
   * 這張表在全域佇列裡的識別（例：`user-list`）。這張表送出的工作進行中時，
   * 操作列換成進度條——在任何分頁打開這張表都看得到。
   */
  scope: string;
  /** 由頁面以 `useTableSelection(data, getRowId)` 建立；`RichTable` 以它控制勾選欄。 */
  selection: TableSelection<TData>;
  actions: ReadonlyArray<BatchAction<TData>>;
  /** 佇列面板與結果對話框列出項目時顯示的名稱。 */
  getRowLabel: (row: TData) => string;
  /**
   * 這一列的樂觀鎖版本（`version`）：隨項目送進佇列，操作以列表上看到的版本更新，
   * 別人已改過的列逐筆失敗而不是被覆寫（ADR-0025 D4）。資源沒有版本時省略。
   */
  getRowVersion?: (row: TData) => number;
}

interface BatchBarProps<TData> {
  batch: RichTableBatch<TData>;
  getRowId: (row: TData) => string;
}

function splitTargets<TData>(
  rows: readonly TData[],
  action: BatchAction<TData>,
): BatchTargets<TData> {
  const eligible: TData[] = [];
  const skipped: TData[] = [];
  for (const row of rows) (action.isEligible(row) ? eligible : skipped).push(row);
  return { eligible, skipped };
}

/**
 * 表格上方的批次區：勾選後是操作列（`BatchActionBar`），確認後把適用的列送進全域佇列
 * （`core/batch`，由 worker 逐筆呼叫單筆 API），這張表的工作進行中時換成進度條。
 * 工作結束時（發起的分頁）成功與已不存在的列移出選取，失敗的保留勾選以便重試。
 */
export function BatchBar<TData>({ batch, getRowId }: BatchBarProps<TData>) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const queue = useBatchQueue();
  const jobs = useBatchJobs();
  const { selection, scope, getRowLabel, getRowVersion } = batch;
  const actions = batch.actions.filter((action) => !action.hidden);
  const count = selection.selectedIds.length;
  const running = jobs.filter((job) => job.scope === scope && isBatchJobActive(job));

  useBatchJobFinished((job) => {
    if (job.scope !== scope) return;
    const done = new Set([
      ...job.succeeded,
      ...job.failures.filter((failure) => isGoneError(failure.error)).map((failure) => failure.id),
    ]);
    selection.onRowSelectionChange(
      Object.fromEntries(
        selection.selectedIds.filter((id) => !done.has(id)).map((id) => [id, true]),
      ),
    );
  });

  const execute = useCallback(
    async (action: BatchAction<TData>) => {
      if (!queue) return;
      const targets = splitTargets(selection.selectedRows, action);
      const content = action.confirm(targets);
      const skippedNote = targets.skipped.length
        ? t('common.batch.skipped', { count: targets.skipped.length })
        : '';
      const confirmed = await confirm({
        title: content.title,
        description: [content.description, skippedNote, t('common.batch.queuedNote')]
          .filter(Boolean)
          .join(' '),
        confirmLabel: content.confirmLabel ?? action.label,
        tone: action.tone === 'danger' || action.tone === 'warning' ? 'danger' : 'primary',
        'data-testid': 'batch-confirm-dialog',
      });
      if (!confirmed) return;
      queue.enqueue({
        operation: action.operation,
        scope,
        items: targets.eligible.map((row) => ({
          id: getRowId(row),
          label: getRowLabel(row),
          version: getRowVersion?.(row),
        })),
      });
    },
    [confirm, getRowId, getRowLabel, getRowVersion, queue, scope, selection.selectedRows, t],
  );

  // 佇列沒有啟用（plugin 未註冊）時不提供批次操作
  if (!queue) return null;

  if (running.length > 0) {
    return <BatchProgressBar jobs={running} onCancel={(jobId) => queue.cancel(jobId)} />;
  }

  if (count === 0 || actions.length === 0) return null;

  return (
    <BatchActionBar
      count={count}
      onClear={selection.clear}
      labels={{
        count: (value) => t('common.batch.selected', { count: value }),
        clear: t('common.batch.clear'),
        toolbar: t('common.batch.toolbar'),
      }}
    >
      {actions.map((action) => {
        // 有權限但當下不能按 → 停用並說明原因（docs/architecture/frontend/06-permission.md §6.1）
        const disabled = splitTargets(selection.selectedRows, action).eligible.length === 0;
        return (
          <Tooltip
            key={action.id}
            content={action.ineligibleReason ?? t('common.batch.noneEligible')}
            disabled={!disabled}
          >
            <Button
              size="sm"
              variant={action.tone ?? 'secondary'}
              disabled={disabled}
              onClick={() => void execute(action)}
              data-testid="batch-action"
              data-value={action.id}
            >
              {action.label}
            </Button>
          </Tooltip>
        );
      })}
    </BatchActionBar>
  );
}
