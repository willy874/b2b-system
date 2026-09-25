import { useCallback, useState } from 'react';

import { useConfirm } from '@/components/ConfirmDialog';
import type { TableSelection } from '@/components/Table';
import { AppError, useErrorMessage, useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';
import type { BatchResult } from '@/shared/api-sdk';

import type { BatchAction, BatchTargets } from './types';

/** 一次批次最多幾筆，與後端 `BATCH_MAX_SIZE` 相同（ADR-0009 D7）。 */
export const BATCH_MAX_SIZE = 200;

/** 未完成的一筆：列的名稱 ＋ 已翻譯的原因。 */
export interface BatchFailureItem {
  id: string;
  label: string;
  message: string;
}

/** 有未完成的項目時，結果對話框要顯示的內容。 */
export interface BatchReport {
  succeeded: number;
  failures: BatchFailureItem[];
}

export interface BatchRunner<TData> {
  /** 跨頁累積超過上限：所有批次按鈕停用。 */
  tooMany: boolean;
  targetsOf: (action: BatchAction<TData>) => BatchTargets<TData>;
  /** 確認 → 送出 → 更新選取 → 提示或結果對話框。 */
  execute: (action: BatchAction<TData>) => Promise<void>;
  report: BatchReport | undefined;
  closeReport: () => void;
}

/** 已經不存在（被別人刪掉）的項目，重試也沒有意義，執行後一併移出選取（ADR-0009 D13）。 */
const isGone = (code: string) => code.endsWith('_NOT_FOUND');

/**
 * 批次動作的流程。成功的從選取移除；未完成的保留勾選，讓使用者修正後重試。
 * 整批層級的錯誤（網路、403、500）以 toast 顯示並留在確認框，選取不變。
 */
export function useBatchRunner<TData>(
  selection: TableSelection<TData>,
  getRowId: (row: TData) => string,
  getRowLabel: (row: TData) => string,
): BatchRunner<TData> {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const toast = useToast();
  const showError = useErrorToast();
  const toMessage = useErrorMessage();
  const [report, setReport] = useState<BatchReport>();

  const targetsOf = useCallback(
    (action: BatchAction<TData>): BatchTargets<TData> => {
      const eligible: TData[] = [];
      const skipped: TData[] = [];
      for (const row of selection.selectedRows) {
        (action.isEligible(row) ? eligible : skipped).push(row);
      }
      return { eligible, skipped };
    },
    [selection.selectedRows],
  );

  const execute = useCallback(
    async (action: BatchAction<TData>) => {
      const targets = targetsOf(action);
      const content = action.confirm(targets);
      const skippedNote = targets.skipped.length
        ? t('common.batch.skipped', { count: targets.skipped.length })
        : '';
      let result: BatchResult | undefined;

      const confirmed = await confirm({
        title: content.title,
        description: [content.description, skippedNote].filter(Boolean).join(' '),
        confirmLabel: content.confirmLabel ?? action.label,
        tone: action.tone ?? 'primary',
        onConfirm: async () => {
          try {
            result = await action.run(targets.eligible.map(getRowId));
          } catch (error) {
            // 提示並重拋：確認框留著，讓使用者決定重試或取消
            showError(error);
            throw error;
          }
        },
        'data-testid': 'batch-confirm-dialog',
      });
      if (!confirmed || !result) return;

      const done = new Set([
        ...result.succeeded,
        ...result.failed.filter((failure) => isGone(failure.code)).map((failure) => failure.id),
      ]);
      selection.onRowSelectionChange(
        Object.fromEntries(
          selection.selectedIds.filter((id) => !done.has(id)).map((id) => [id, true]),
        ),
      );

      if (!result.failed.length) {
        toast.success(action.successMessage(result.succeeded.length));
        return;
      }
      const labelById = new Map(targets.eligible.map((row) => [getRowId(row), getRowLabel(row)]));
      setReport({
        succeeded: result.succeeded.length,
        failures: result.failed.map((failure) => ({
          id: failure.id,
          label: labelById.get(failure.id) ?? failure.id,
          message: toMessage(new AppError(failure.code, 0, failure.details)),
        })),
      });
    },
    [confirm, getRowId, getRowLabel, selection, showError, t, targetsOf, toMessage, toast],
  );

  return {
    tooMany: selection.selectedIds.length > BATCH_MAX_SIZE,
    targetsOf,
    execute,
    report,
    closeReport: useCallback(() => setReport(undefined), []),
  };
}
