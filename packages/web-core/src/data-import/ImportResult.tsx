import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { FormError } from '@b2b-system/ui/FormError';
import { Icon } from '@b2b-system/ui/Icon';
import { Progress } from '@b2b-system/ui/Progress';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

import {
  ACTIVE_TRANSFER_STATUSES,
  downloadBlob,
  ROW_OUTCOME_LABEL_KEY,
  ROW_OUTCOME_TONE,
  TRANSFER_STATUS_LABEL_KEY,
  TRANSFER_STATUS_TONE,
  useIssueMessage,
  useTransferQuery,
} from '../data-transfer';
import type {
  ApplyRowView,
  ImportApi,
  ImportColumnView,
  ImportRow,
  RowIssue,
} from '../data-transfer';
import { AppError, useErrorMessage, useErrorToast } from '../errors';
import { useTranslation } from '../locales';

/** 結果表最多顯示的列數；更多的看結果報告。 */
const RESULT_PREVIEW_LIMIT = 1000;
/** 失敗的排前面（§7.7）。 */
const OUTCOME_ORDER: Readonly<Record<ApplyRowView['outcome'], number>> = {
  failed: 0,
  cancelled: 1,
  skipped: 2,
  pending: 3,
  succeeded: 4,
};

export interface ImportResultProps {
  api: ImportApi;
  type: string;
  transferId: string;
  /** 結果連到紀錄的詳情（新增模式也有 `resultId`）。 */
  renderRecordLink?: (id: string) => ReactNode;
  /** 以失敗的列重新匯入：這些列與當初的欄位，開成新的預覽。 */
  onReimport: (columns: ImportColumnView[], rows: ImportRow[], fileName: string | null) => void;
  onNewImport: () => void;
}

/** 步驟 7～8（docs/architecture/backend/22-data-transfer.md §7.2、§7.7）：套用的進度與結果、結果報告、以失敗的列重新匯入。 */
export function ImportResult({
  api,
  type,
  transferId,
  renderRecordLink,
  onReimport,
  onNewImport,
}: ImportResultProps) {
  const { t } = useTranslation();
  const issueMessage = useIssueMessage();
  const errorMessage = useErrorMessage();
  const showError = useErrorToast();
  const [busy, setBusy] = useState(false);
  const transfer = useTransferQuery(api, transferId).data;
  const ended = transfer && !ACTIVE_TRANSFER_STATUSES.has(transfer.status);
  const rows = useQuery({
    queryKey: api.transferRowsKey(transferId),
    queryFn: ({ signal }) => api.fetchRows(transferId, { limit: RESULT_PREVIEW_LIMIT }, signal),
    enabled: Boolean(ended && transfer?.status !== 'expired'),
  });
  const sorted = (rows.data?.items ?? []).toSorted(
    (a, b) => OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome] || a.rowNo - b.rowNo,
  );

  const describe = (row: ApplyRowView): string => {
    if (row.changes) {
      return Object.entries(row.changes)
        .map(([column, values]) =>
          t('dataTransfer.import.resultChange', {
            column,
            from: values[0] || '—',
            to: values[1] || '—',
          }),
        )
        .join('；');
    }
    const failure = row.error;
    if (!failure) return '';
    if (Array.isArray(failure.issues)) {
      return (failure.issues as RowIssue[]).map((issue) => issueMessage(issue)).join('；');
    }
    return errorMessage(
      new AppError(
        String(failure.code ?? 'INTERNAL_ERROR'),
        0,
        failure.details as Record<string, unknown> | undefined,
      ),
    );
  };

  const report = (rowsKind: 'all' | 'failed') =>
    void api
      .downloadReport(transferId, { format: 'xlsx', rows: rowsKind })
      .then(({ blob, fileName }) => downloadBlob(blob, fileName), showError);

  const reimportFailed = async () => {
    if (!transfer) return;
    setBusy(true);
    try {
      const failed: ApplyRowView[] = [];
      let after: number | undefined;
      do {
        const page = await api.fetchRows(transferId, {
          outcome: ['failed'],
          afterRowNo: after,
          limit: RESULT_PREVIEW_LIMIT,
        });
        failed.push(...page.items);
        after = page.nextRowNo ?? undefined;
      } while (after !== undefined);
      const all = await api.fetchColumns(
        type,
        transfer.mode ?? 'create',
        new AbortController().signal,
      );
      const used = new Set(failed.flatMap((row) => Object.keys(row.cells)));
      const columns = all.items.filter((column) => used.has(column.key));
      onReimport(
        columns,
        failed.map((row, index) => ({
          rowNo: index + 1,
          sourceRow: row.sourceRow,
          cells: Object.fromEntries(
            columns.map((column) => [column.key, row.cells[column.key] ?? '']),
          ),
        })),
        transfer.sourceName,
      );
    } catch (failure) {
      showError(failure);
    } finally {
      setBusy(false);
    }
  };

  if (!transfer) return null;
  if (!ended) {
    return (
      <section
        className="flex flex-col gap-3"
        data-testid="import-progress"
        data-value={transfer.status}
      >
        <Progress
          value={transfer.totalRows ? (transfer.processedRows / transfer.totalRows) * 100 : null}
          label={t('dataTransfer.import.progress', {
            processed: transfer.processedRows.toLocaleString(),
            total: transfer.totalRows.toLocaleString(),
          })}
        />
        <div>
          <Button
            variant="secondary"
            onClick={() => void api.cancel(transfer.id, transfer.version).catch(showError)}
            data-testid="import-cancel"
          >
            {t('dataTransfer.import.cancel')}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section
      className="flex flex-col gap-4"
      data-testid="import-result"
      data-value={transfer.status}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-base font-semibold">{t('dataTransfer.import.resultTitle')}</h2>
        <Chip tone={TRANSFER_STATUS_TONE[transfer.status]}>
          {t(TRANSFER_STATUS_LABEL_KEY[transfer.status])}
        </Chip>
        <Chip
          tone="success"
          data-testid="import-result-succeeded"
          data-value={String(transfer.succeededRows)}
        >
          {t('dataTransfer.import.resultSucceeded', { rows: transfer.succeededRows })}
        </Chip>
        <Chip
          tone="danger"
          data-testid="import-result-failed"
          data-value={String(transfer.failedRows)}
        >
          {t('dataTransfer.import.resultFailed', { rows: transfer.failedRows })}
        </Chip>
        <Chip tone="warning">
          {t('dataTransfer.import.resultSkipped', { rows: transfer.skippedRows })}
        </Chip>
      </div>
      {transfer.errorCode && (
        <FormError code={transfer.errorCode}>
          {errorMessage(new AppError(transfer.errorCode, 0))}
        </FormError>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          startIcon={<Icon name="download" size={14} />}
          onClick={() => report('all')}
          data-testid="import-report"
        >
          {t('dataTransfer.import.downloadReport')}
        </Button>
        {transfer.failedRows > 0 && (
          <>
            <Button variant="secondary" onClick={() => report('failed')}>
              {t('dataTransfer.import.downloadFailedReport')}
            </Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() => void reimportFailed()}
              data-testid="import-retry-failed"
            >
              {t('dataTransfer.import.retryFailed')}
            </Button>
          </>
        )}
        <span className="flex-1" />
        <Button variant="secondary" onClick={onNewImport} data-testid="import-new">
          {t('dataTransfer.import.newImport')}
        </Button>
      </div>
      <div className="max-h-[480px] overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
        <table className="w-full border-collapse text-sm" data-testid="import-result-rows">
          <thead className="sticky top-0 bg-[var(--color-fill-subtle)] text-left">
            <tr>
              <th className="px-3 py-2">{t('dataTransfer.import.resultRow')}</th>
              <th className="px-3 py-2">{t('dataTransfer.import.resultOutcome')}</th>
              <th className="px-3 py-2">{t('dataTransfer.import.resultMessage')}</th>
              <th className="px-3 py-2">
                <span className="sr-only">{t('dataTransfer.import.viewRecord')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.rowNo}
                className="border-t border-[var(--color-border)]"
                data-testid="import-result-row"
                data-value={row.outcome}
              >
                <td className="px-3 py-2 tabular-nums">{row.sourceRow ?? row.rowNo}</td>
                <td className="px-3 py-2">
                  <Chip tone={ROW_OUTCOME_TONE[row.outcome]}>
                    {t(ROW_OUTCOME_LABEL_KEY[row.outcome])}
                  </Chip>
                </td>
                <td className="px-3 py-2">{describe(row)}</td>
                <td className="px-3 py-2">{row.resultId && renderRecordLink?.(row.resultId)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
