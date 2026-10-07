import { Button, IconButton } from '@b2b-system/ui/Button';
import { Checkbox } from '@b2b-system/ui/Checkbox';
import { Chip } from '@b2b-system/ui/Chip';
import { DataGrid } from '@b2b-system/ui/DataGrid';
import type { DataGridCellState, DataGridColumn, DataGridRow } from '@b2b-system/ui/DataGrid';
import { Dialog } from '@b2b-system/ui/Dialog';
import { FormError } from '@b2b-system/ui/FormError';
import { Icon } from '@b2b-system/ui/Icon';
import { Tabs } from '@b2b-system/ui/Tabs';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { useMemo, useState } from 'react';
import type { Key } from 'react';

import { COLUMN_KIND_LABEL_KEY, useIssueMessage } from '../data-transfer';
import type { ImportApi, RowIssue } from '../data-transfer';
import { useErrorMessage } from '../errors';
import { useTranslation } from '../locales';
import { rowIssues, rowStatus } from './importState';
import type { RowStatus } from './importState';
import type { ImportWorkspaceModel } from './useImportWorkspace';

/** `\N`：修改模式中代表清空（§7.5），畫面上顯示成「清空」標籤。 */
const NULL_TOKEN = '\\N';
const TARGET_COLUMN = '__target';

type Filter = 'all' | 'errors' | 'warnings' | 'changed' | 'unchanged';

const FILTER_LABEL_KEY = {
  all: 'dataTransfer.import.filterAll',
  errors: 'dataTransfer.import.filterErrors',
  warnings: 'dataTransfer.import.filterWarnings',
  changed: 'dataTransfer.import.filterChanged',
  unchanged: 'dataTransfer.import.filterUnchanged',
} as const satisfies Record<Filter, string>;

const FILTER_STATUSES: Readonly<Record<Filter, readonly RowStatus[] | null>> = {
  all: null,
  errors: ['error'],
  warnings: ['warning'],
  changed: ['changed'],
  unchanged: ['unchanged'],
};

const ROW_TONE: Partial<Record<RowStatus, DataGridRow['tone']>> = {
  error: 'error',
  warning: 'warning',
  changed: 'changed',
  pending: 'pending',
};

export interface ImportPreviewProps {
  api: ImportApi;
  type: string;
  workspace: ImportWorkspaceModel;
  onSubmitted: (transferId: string) => void;
}

/**
 * 步驟 6～7（docs/architecture/backend/22-data-transfer.md §7.2、§8.3）：類似 Excel 的預覽表格。資料是前端持有的 JSON，
 * 改過的列交給後端驗證；修改模式顯示「原值 → 新值」，沒有變更的儲存格淡化。
 */
export function ImportPreview({ api, type, workspace, onSubmitted }: ImportPreviewProps) {
  const { t } = useTranslation();
  const issueMessage = useIssueMessage();
  const errorMessage = useErrorMessage();
  const { state, local, summary } = workspace;
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<ReadonlySet<Key>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const isUpdate = state.mode === 'update';

  const columns = useMemo<DataGridColumn[]>(() => {
    const data = state.columns.map<DataGridColumn>((column) => ({
      key: column.key,
      name: column.label,
      required: column.required,
      description: [
        t(COLUMN_KIND_LABEL_KEY[column.kind]),
        column.hint,
        column.multiple ? t('dataTransfer.import.multiple') : null,
        column.options?.map((option) => option.label).join(t('dataTransfer.separator')),
      ]
        .filter(Boolean)
        .join('\n'),
      width: column.kind === 'string' ? 200 : 150,
      ...(column.options ? { options: column.options } : {}),
      ...(column.kind === 'reference'
        ? {
            loadSuggestions: async (keyword: string) =>
              (await api.searchOptions(type, column.key, keyword)).map((item) => item.label),
          }
        : {}),
      renderValue: (value: string) =>
        value === NULL_TOKEN ? (
          <Chip tone="warning">{t('dataTransfer.import.clearValue')}</Chip>
        ) : (
          value
        ),
    }));
    if (!isUpdate) return data;
    return [
      { key: TARGET_COLUMN, name: t('dataTransfer.import.target'), editable: false, width: 200 },
      ...data,
    ];
  }, [api, isUpdate, state.columns, t, type]);

  const visible = useMemo(() => {
    const statuses = FILTER_STATUSES[filter];
    return statuses
      ? state.rows.filter((row) => statuses.includes(rowStatus(state, local, row)))
      : state.rows;
  }, [filter, local, state]);

  const gridRows = useMemo<DataGridRow[]>(
    () =>
      visible.map((row) => {
        const status = rowStatus(state, local, row);
        const result = state.results[row.rowNo];
        const issues = rowIssues(state, local, row.rowNo);
        const states: Record<string, DataGridCellState> = {};
        for (const column of state.columns) {
          const columnIssues = issues.filter((issue) => issue.column === column.key);
          const message = columnIssues.map((issue) => issueMessage(issue)).join('\n');
          if (columnIssues.some((issue) => issue.severity === 'error')) {
            states[column.key] = { tone: 'error', message };
          } else if (columnIssues.length) {
            states[column.key] = { tone: 'warning', message };
          } else if (status === 'pending') {
            states[column.key] = { tone: 'pending' };
          } else if (isUpdate && result?.target) {
            const current = result.target.current[column.key] ?? '';
            states[column.key] = result.changed?.includes(column.key)
              ? {
                  tone: 'changed',
                  message: t('dataTransfer.import.changedFrom', { value: current }),
                }
              : { tone: 'unchanged' };
          }
        }
        const rowLevel = issues.filter((issue: RowIssue) => issue.column === null);
        return {
          key: row.rowNo,
          cells: isUpdate
            ? { ...row.cells, [TARGET_COLUMN]: result?.target?.label ?? '' }
            : row.cells,
          states,
          tone: ROW_TONE[status],
          header: (
            <span
              className="flex items-center gap-1"
              title={rowLevel.map((issue) => issueMessage(issue)).join('\n') || undefined}
              data-testid="import-row-status"
              data-value={status}
            >
              {row.sourceRow ?? row.rowNo}
              {rowLevel.length > 0 && <Icon name="warning" size={14} />}
            </span>
          ),
        };
      }),
    [isUpdate, issueMessage, local, state, t, visible],
  );

  const rowNoAt = (index: number) => visible[index]?.rowNo;
  const counts: Record<Filter, number> = {
    all: summary.total,
    errors: summary.errors,
    warnings: summary.warnings,
    changed: summary.changed,
    unchanged: summary.unchanged,
  };
  const blocked = summary.errors > 0 && !skipInvalid;
  const submitCount = workspace.submittable.length;

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3" data-testid="import-preview">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          value={filter}
          onValueChange={(value) => setFilter(value as Filter)}
          tabs={(Object.keys(FILTER_LABEL_KEY) as Filter[])
            .filter((key) => isUpdate || (key !== 'changed' && key !== 'unchanged'))
            .map((key) => ({ value: key, label: `${t(FILTER_LABEL_KEY[key])} ${counts[key]}` }))}
          fit={false}
          data-testid="import-filter"
        />
        <span className="flex-1" />
        {workspace.validating && (
          <output className="text-sm text-[var(--color-fg-muted)]" data-testid="import-validating">
            {t('dataTransfer.import.validating')}
          </output>
        )}
        <Tooltip content={t('dataTransfer.import.undo')}>
          <IconButton
            size="sm"
            aria-label={t('dataTransfer.import.undo')}
            onClick={workspace.undo}
            disabled={!state.history.undo.length}
          >
            <Icon name="undo" size={16} />
          </IconButton>
        </Tooltip>
        <Tooltip content={t('dataTransfer.import.redo')}>
          <IconButton
            size="sm"
            aria-label={t('dataTransfer.import.redo')}
            onClick={workspace.redo}
            disabled={!state.history.redo.length}
          >
            <Icon name="redo" size={16} />
          </IconButton>
        </Tooltip>
        {isUpdate && (
          <Button
            size="sm"
            variant="secondary"
            startIcon={<Icon name="refresh" size={14} />}
            onClick={workspace.revalidateAll}
            data-testid="import-revalidate"
          >
            {t('dataTransfer.import.revalidate')}
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          startIcon={<Icon name="plus" size={14} />}
          onClick={workspace.addRow}
          data-testid="import-add-row"
        >
          {t('dataTransfer.import.addRow')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          startIcon={<Icon name="trash" size={14} />}
          disabled={selected.size === 0}
          onClick={() => {
            workspace.removeRows([...selected].map(Number));
            setSelected(new Set());
          }}
          data-testid="import-remove-rows"
        >
          {t('dataTransfer.import.removeRows')}
        </Button>
      </div>

      <p className="m-0 text-sm text-[var(--color-fg-muted)]" data-testid="import-summary">
        {t('dataTransfer.import.summary', {
          total: summary.total,
          errors: summary.errors,
          warnings: summary.warnings,
        })}
        {isUpdate &&
          ` ${t('dataTransfer.import.summaryChanged', { changed: summary.changed, unchanged: summary.unchanged })}`}
        {state.ignored.length > 0 &&
          ` ${t('dataTransfer.import.ignoredColumns', { columns: state.ignored.join(t('dataTransfer.separator')) })}`}
      </p>

      <div className="min-h-[360px] flex-1">
        <DataGrid
          columns={columns}
          rows={gridRows}
          onCellsChange={(changes) =>
            workspace.edit(
              changes.flatMap((change) => {
                const rowNo = rowNoAt(change.rowIndex);
                return rowNo === undefined || change.key === TARGET_COLUMN
                  ? []
                  : [{ rowNo, key: change.key, value: change.value }];
              }),
            )
          }
          onUndo={workspace.undo}
          onRedo={workspace.redo}
          selectedRows={selected}
          onSelectedRowsChange={setSelected}
          labels={{ rowHeader: t('dataTransfer.import.rowHeader') }}
          aria-label={t('dataTransfer.import.previewLabel')}
          data-testid="import-grid"
        />
      </div>

      {workspace.error !== null && <FormError>{errorMessage(workspace.error)}</FormError>}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="secondary"
          onClick={() => void workspace.discard()}
          data-testid="import-discard"
        >
          {t('dataTransfer.import.discard')}
        </Button>
        <Button
          variant="primary"
          disabled={submitCount === 0 || workspace.validating}
          onClick={() => setConfirming(true)}
          data-testid="import-submit"
        >
          {workspace.validating
            ? t('dataTransfer.import.validating')
            : t('dataTransfer.import.submit', { rows: submitCount })}
        </Button>
      </div>

      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('dataTransfer.import.submitTitle')}
        description={t('dataTransfer.import.submitDescription', { rows: submitCount })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={blocked}
              loading={workspace.phase === 'submitting'}
              onClick={() =>
                void workspace.submit(skipInvalid).then((transfer) => {
                  setConfirming(false);
                  if (transfer) onSubmitted(transfer.id);
                })
              }
              data-testid="import-submit-confirm"
            >
              {t('dataTransfer.import.submitConfirm')}
            </Button>
          </>
        }
        data-testid="import-submit-dialog"
      >
        <div className="flex flex-col gap-3">
          {summary.errors > 0 && (
            <>
              <Checkbox
                checked={skipInvalid}
                onCheckedChange={setSkipInvalid}
                label={t('dataTransfer.import.skipInvalid', { rows: summary.errors })}
                data-testid="import-skip-invalid"
              />
              {blocked && (
                <FormError>
                  {t('dataTransfer.import.hasErrors', { rows: summary.errors })}
                </FormError>
              )}
            </>
          )}
        </div>
      </Dialog>
    </section>
  );
}
