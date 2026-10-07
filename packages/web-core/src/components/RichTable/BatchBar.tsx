import { Button } from '@b2b-system/ui/Button';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import type { TableSelection } from '@b2b-system/ui/Table';
import { BatchActionBar } from '@b2b-system/ui/Table';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { useCallback, useState } from 'react';

import {
  BATCH_SELECT_ALL_MAX,
  BatchProgressBar,
  collectAllPages,
  isBatchJobActive,
  isGoneError,
  useBatchJobFinished,
  useBatchJobs,
  useBatchQueue,
} from '../../batch';
import type { BatchAction, BatchPageFetcher, BatchTargets } from '../../batch';
import { useErrorMessage } from '../../errors';
import { useTranslation } from '../../locales';

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
   * 別人已改過的列逐筆失敗而不是被覆寫（docs/architecture/backend/14-revisions.md §9.2 D4）。資源沒有版本時省略。
   */
  getRowVersion?: (row: TData) => number;
  /**
   * 「選取全部符合的 N 筆」（docs/architecture/frontend/07-ui-system.md §13.7）：`total` 是目前篩選的總筆數，
   * `fetchPage` 以同樣的篩選與排序取一頁（列表頁呼叫自己 feature 的 `apis/`）。省略時只有明確的勾選。
   */
  selectAllMatching?: { total: number; fetchPage: BatchPageFetcher<TData> };
}

interface BatchBarProps<TData> {
  batch: RichTableBatch<TData>;
  getRowId: (row: TData) => string;
  /** 目前這一頁的列：整頁都勾選時才提供「選取全部符合」。 */
  pageRows: readonly TData[];
}

interface Collecting {
  collected: number;
  total: number;
  controller: AbortController;
}

function splitTargets<TData>(
  rows: readonly TData[],
  action: BatchAction<TData>,
): BatchTargets<TData> {
  const eligible: TData[] = [];
  const skipped: TData[] = [];
  for (const row of rows)
    (!action.isEligible || action.isEligible(row) ? eligible : skipped).push(row);
  return { eligible, skipped };
}

/**
 * 表格上方的批次區：勾選後是操作列（`BatchActionBar`），確認後把適用的列送進全域佇列
 * （`batch`，由 worker 逐筆呼叫單筆 API），這張表的工作進行中時換成進度條。
 * 工作結束時（發起的分頁）成功與已不存在的列移出選取，失敗的保留勾選以便重試。
 * 不是表格的列表（例：通知列表的虛擬捲動）也直接用它，勾選狀態一樣來自 `useTableSelection`。
 */
export function BatchBar<TData>({ batch, getRowId, pageRows }: BatchBarProps<TData>) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const confirm = useConfirm();
  const queue = useBatchQueue();
  const jobs = useBatchJobs();
  const { selection, scope, getRowLabel, getRowVersion, selectAllMatching } = batch;
  const actions = batch.actions.filter((action) => !action.hidden);
  const running = jobs.filter((job) => job.scope === scope && isBatchJobActive(job));
  // 「全部符合」模式記住進入當下的勾選：勾選有任何變化（取消勾選一列、篩選改變而清空）就回到明確選取
  const selectionKey = selection.selectedIds.join('\n');
  const [allMatchingKey, setAllMatchingKey] = useState<string>();
  const allMatching =
    selectAllMatching !== undefined &&
    allMatchingKey === selectionKey &&
    selectAllMatching.total <= BATCH_SELECT_ALL_MAX;
  const [collecting, setCollecting] = useState<Collecting>();
  const [collectError, setCollectError] = useState<string>();
  const count = allMatching ? selectAllMatching.total : selection.selectedIds.length;
  const selected = new Set(selection.selectedIds);
  const pageFullySelected =
    pageRows.length > 0 && pageRows.every((row) => selected.has(getRowId(row)));
  const offerAllMatching =
    selectAllMatching !== undefined &&
    !allMatching &&
    pageFullySelected &&
    selectAllMatching.total > selection.selectedIds.length;

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

  /** 「全部符合」模式：先逐頁收集（可中止），收集完才確認——確認框的筆數與略過數是實際的。 */
  const collect = useCallback(async (): Promise<TData[] | undefined> => {
    if (!selectAllMatching) return undefined;
    const controller = new AbortController();
    setCollectError(undefined);
    setCollecting({ collected: 0, total: selectAllMatching.total, controller });
    try {
      return await collectAllPages({
        fetchPage: selectAllMatching.fetchPage,
        signal: controller.signal,
        onProgress: (collected, total) => setCollecting({ collected, total, controller }),
      });
    } catch (error) {
      if (!controller.signal.aborted) setCollectError(toMessage(error));
      return undefined;
    } finally {
      setCollecting(undefined);
    }
  }, [selectAllMatching, toMessage]);

  const execute = useCallback(
    async (action: BatchAction<TData>) => {
      if (action.kind === 'run') {
        // 不入佇列：「全部符合」也不先收集，交給呼叫端以篩選條件處理
        action.run({ rows: splitTargets(selection.selectedRows, action).eligible, allMatching });
        return;
      }
      if (!queue) return;
      const rows = allMatching ? await collect() : selection.selectedRows;
      // 中止或收集失敗：不送出任何請求
      if (!rows) return;
      const targets = splitTargets(rows, action);
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
      // 「全部符合」送出後回到明確選取：失敗的項目在結果對話框裡，不再勾選上萬筆
      if (allMatching) selection.clear();
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
    [
      allMatching,
      collect,
      confirm,
      getRowId,
      getRowLabel,
      getRowVersion,
      queue,
      scope,
      selection,
      t,
    ],
  );

  // 佇列沒有啟用（plugin 未註冊）時只提供不入佇列的動作
  const available = queue ? actions : actions.filter((action) => action.kind === 'run');
  if (available.length === 0) return null;

  if (running.length > 0) {
    return <BatchProgressBar jobs={running} onCancel={(jobId) => queue?.cancel(jobId)} />;
  }

  if (collecting) {
    return (
      <div
        className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-sm"
        data-testid="batch-collecting"
      >
        <output>
          {t('common.batch.collecting', {
            collected: collecting.collected,
            total: collecting.total,
          })}
        </output>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => collecting.controller.abort()}
          data-testid="batch-collect-cancel"
        >
          {t('common.cancel')}
        </Button>
      </div>
    );
  }

  if (count === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <BatchActionBar
        count={count}
        onClear={selection.clear}
        labels={{
          count: (value) => t('common.batch.selected', { count: value }),
          clear: t('common.batch.clear'),
          toolbar: t('common.batch.toolbar'),
        }}
      >
        {available.map((action) => {
          // 有權限但當下不能按 → 停用並說明原因（docs/architecture/frontend/06-permission.md §6.1）；
          // 「全部符合」在收集之前不知道哪些適用，一律可按，確認框再告知略過幾筆
          const disabled =
            !allMatching && splitTargets(selection.selectedRows, action).eligible.length === 0;
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
      {allMatching && (
        <p className="m-0 text-sm text-[var(--color-fg-muted)]" data-testid="batch-all-matching">
          {t('common.batch.allMatchingSelected', { count: selectAllMatching.total })}
        </p>
      )}
      {offerAllMatching && selectAllMatching.total <= BATCH_SELECT_ALL_MAX && (
        <p className="m-0 flex flex-wrap items-center gap-1 text-sm text-[var(--color-fg-muted)]">
          {t('common.batch.pageSelected', { count: selection.selectedIds.length })}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setAllMatchingKey(selectionKey)}
            data-testid="batch-select-all-matching"
          >
            {t('common.batch.selectAllMatching', { count: selectAllMatching.total })}
          </Button>
        </p>
      )}
      {offerAllMatching && selectAllMatching.total > BATCH_SELECT_ALL_MAX && (
        <p
          className="m-0 text-sm text-[var(--color-fg-muted)]"
          data-testid="batch-select-all-too-many"
        >
          {t('common.batch.tooManyToSelect', {
            total: selectAllMatching.total,
            max: BATCH_SELECT_ALL_MAX,
          })}
        </p>
      )}
      {collectError && (
        <p
          role="alert"
          className="m-0 text-sm text-[var(--color-danger-text)]"
          data-testid="batch-collect-error"
        >
          {collectError}
        </p>
      )}
    </div>
  );
}
