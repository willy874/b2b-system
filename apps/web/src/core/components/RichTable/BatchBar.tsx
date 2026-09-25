import { Button } from '@/components/Button';
import type { TableSelection } from '@/components/Table';
import { BatchActionBar } from '@/components/Table';
import { Tooltip } from '@/components/Tooltip';
import { BATCH_MAX_SIZE, BatchResultDialog, useBatchRunner } from '@/core/batch';
import type { BatchAction } from '@/core/batch';
import { useTranslation } from '@/core/locales';

/** `RichTable` 的批次操作（docs/architecture/frontend/07-ui-system.md §6.2）。 */
export interface RichTableBatch<TData> {
  /** 由頁面以 `useTableSelection(data, getRowId)` 建立；`RichTable` 以它控制勾選欄。 */
  selection: TableSelection<TData>;
  actions: ReadonlyArray<BatchAction<TData>>;
  /** 結果對話框列出未完成項目時顯示的名稱。 */
  getRowLabel: (row: TData) => string;
}

interface BatchBarProps<TData> {
  batch: RichTableBatch<TData>;
  getRowId: (row: TData) => string;
}

/**
 * 勾選後出現在表格上方的操作列。結果對話框掛在操作列之外：
 * 執行完選取可能被清空（操作列消失），對話框仍要留著。
 */
export function BatchBar<TData>({ batch, getRowId }: BatchBarProps<TData>) {
  const { t } = useTranslation();
  const runner = useBatchRunner(batch.selection, getRowId, batch.getRowLabel);
  const actions = batch.actions.filter((action) => !action.hidden);
  const count = batch.selection.selectedIds.length;

  return (
    <>
      {count > 0 && actions.length > 0 && (
        <BatchActionBar
          count={count}
          onClear={batch.selection.clear}
          labels={{
            count: (value) => t('common.batch.selected', { count: value }),
            clear: t('common.batch.clear'),
            toolbar: t('common.batch.toolbar'),
          }}
        >
          {actions.map((action) => {
            // 有權限但當下不能按 → 停用並說明原因（docs/architecture/frontend/06-permission.md §6.1）
            const noneEligible = runner.targetsOf(action).eligible.length === 0;
            const disabled = runner.tooMany || noneEligible;
            const reason = runner.tooMany
              ? t('common.batch.tooMany', { max: BATCH_MAX_SIZE })
              : (action.ineligibleReason ?? t('common.batch.noneEligible'));
            return (
              <Tooltip key={action.id} content={reason} disabled={!disabled}>
                <Button
                  size="sm"
                  variant={action.tone ?? 'secondary'}
                  disabled={disabled}
                  onClick={() => void runner.execute(action)}
                  data-testid="batch-action"
                  data-value={action.id}
                >
                  {action.label}
                </Button>
              </Tooltip>
            );
          })}
        </BatchActionBar>
      )}
      <BatchResultDialog report={runner.report} onClose={runner.closeReport} />
    </>
  );
}
