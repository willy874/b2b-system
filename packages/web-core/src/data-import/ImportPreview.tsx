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
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Key } from 'react';

import { COLUMN_KIND_LABEL_KEY, useIssueMessage } from '../data-transfer';
import type { ImportApi, ImportColumnView, ImportRow, RowIssue } from '../data-transfer';
import { useErrorMessage } from '../errors';
import { isMacPlatform, registerHotkey } from '../hotkey';
import { useTranslation } from '../locales';
import { rowIssues, rowStatus } from './importState';
import type { RowStatus } from './importState';
import type { ImportWorkspaceModel } from './useImportWorkspace';

/** `\N`：修改模式中代表清空（§7.5），畫面上顯示成「清空」標籤。 */
const NULL_TOKEN = '\\N';
const TARGET_COLUMN = '__target';
/** 比對目標欄的特殊值：依比對鍵自動比對、撤回比對。 */
const TARGET_AUTO = '__auto';
const TARGET_NONE = '__none';
/** 落在比對目標欄的列層級問題。 */
const TARGET_ISSUES: ReadonlySet<string> = new Set([
  'targetNotSelected',
  'targetNotFound',
  'matchKeyRequired',
  'ambiguousMatch',
]);
/** 多值欄位的分隔字元（與後端一致）。 */
const SEPARATOR = ';';
/** 自動完成最多列出幾個建議。 */
const SUGGESTION_LIMIT = 10;

function targetCell(row: ImportRow): string {
  if (row.target === undefined) return TARGET_AUTO;
  return row.target?.id ?? TARGET_NONE;
}

/**
 * 同一欄已經填過的值（Excel 的自動完成）。唯一欄在新增模式不建議填過的值（一定重複），
 * 改成補完 Email 的網域：輸入 `alice@` 時建議同一欄出現過的 `@example.com`。
 */
function localSuggestions(
  rows: readonly ImportRow[],
  column: ImportColumnView,
  keyword: string,
  createMode: boolean,
): string[] {
  const wanted = keyword.toLowerCase();
  const values = new Set<string>();
  const at = keyword.indexOf('@');
  if (at >= 0) {
    const [local, domain] = [keyword.slice(0, at), keyword.slice(at + 1).toLowerCase()];
    for (const row of rows) {
      const text = row.cells[column.key] ?? '';
      const found = text.slice(text.indexOf('@') + 1);
      if (text.includes('@') && found.toLowerCase().startsWith(domain) && local) {
        values.add(`${local}@${found}`);
      }
    }
  }
  if (!(createMode && column.unique)) {
    for (const row of rows) {
      const text = (row.cells[column.key] ?? '').trim();
      if (text && text !== NULL_TOKEN && text.toLowerCase().includes(wanted)) values.add(text);
    }
  }
  return [...values].slice(0, SUGGESTION_LIMIT);
}

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

  // 編輯器的查詢在事件中才執行：以 ref 讀最新的列，欄位定義不必隨每次編輯重建
  const rowsRef = useRef(state.rows);
  useEffect(() => {
    rowsRef.current = state.rows;
  }, [state.rows]);
  /** 比對目標下拉選單查到的名稱：選取時寫進列上的 `target`（草稿與畫面都用它）。 */
  const searchedTargets = useRef(new Map<string, string>());
  const canPickTarget = isUpdate && Boolean(api.searchTargets);
  /** 手動指定的目標 id → 名稱。 */
  const manualLabels = useMemo(
    () =>
      new Map(
        state.rows.flatMap((row) =>
          row.target ? [[row.target.id, row.target.label] as const] : [],
        ),
      ),
    [state.rows],
  );

  const columns = useMemo<DataGridColumn[]>(() => {
    const data = state.columns.map<DataGridColumn>((column) => {
      const editor: Partial<DataGridColumn> = {};
      if (column.options) {
        // 儲存格是選項的名稱（與檔案、匯出相同的文字），不是值代碼
        editor.options = column.options.map((option) => ({
          value: option.label,
          label: option.label,
        }));
      } else if (column.kind === 'reference') {
        editor.loadOptions = async (keyword: string) =>
          (await api.searchOptions(type, column.key, keyword)).map((item) => ({
            value: item.label,
            label: item.label,
          }));
        editor.multiple = column.multiple;
        editor.separator = SEPARATOR;
      } else if (column.kind === 'string' && !column.multiple) {
        editor.loadSuggestions = async (keyword: string) => {
          if (!keyword) return [];
          const local = localSuggestions(rowsRef.current, column, keyword, !isUpdate);
          // 伺服器的建議（現有資料的值）只在修改模式有意義：新增模式填現有的值一定重複
          const remote =
            isUpdate && column.suggest
              ? (await api.searchOptions(type, column.key, keyword)).map((item) => item.label)
              : [];
          return [...new Set([...local, ...remote])].slice(0, SUGGESTION_LIMIT);
        };
      }
      return {
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
        ...editor,
        renderValue: (value: string) =>
          value === NULL_TOKEN ? (
            <Chip tone="warning">{t('dataTransfer.import.clearValue')}</Chip>
          ) : (
            value
          ),
      };
    });
    if (!isUpdate) return data;
    const target: DataGridColumn = {
      key: TARGET_COLUMN,
      name: t('dataTransfer.import.target'),
      width: 240,
      editable: canPickTarget,
      renderValue: (value, row) => {
        const result = state.results[Number(row.key)];
        if (value === TARGET_NONE) {
          return <Chip tone="warning">{t('dataTransfer.import.targetUnmatched')}</Chip>;
        }
        if (value === TARGET_AUTO) {
          return (
            result?.target?.label ?? (
              <span className="text-[var(--color-fg-muted)]">
                {t('dataTransfer.import.targetUnmatched')}
              </span>
            )
          );
        }
        return (
          <span className="flex items-center gap-1" data-testid="import-target-manual">
            <span className="truncate">{manualLabels.get(value) ?? value}</span>
            <Chip tone="brand">{t('dataTransfer.import.targetManual')}</Chip>
          </span>
        );
      },
      ...(canPickTarget
        ? {
            options: [
              {
                value: TARGET_AUTO,
                label: t('dataTransfer.import.targetAuto'),
                description: t('dataTransfer.import.targetAutoHint'),
              },
              {
                value: TARGET_NONE,
                label: t('dataTransfer.import.targetNone'),
                description: t('dataTransfer.import.targetNoneHint'),
              },
            ],
            rowOptions: (row: DataGridRow) => {
              const value = row.cells[TARGET_COLUMN] ?? '';
              const label = manualLabels.get(value);
              return label ? [{ value, label }] : [];
            },
            loadOptions: async (keyword: string) => {
              const items = (await api.searchTargets?.(type, keyword)) ?? [];
              for (const item of items) searchedTargets.current.set(item.id, item.label);
              return items.map((item) => ({
                value: item.id,
                label: item.label,
                ...(item.description ? { description: item.description } : {}),
              }));
            },
          }
        : {}),
    };
    return [target, ...data];
  }, [api, canPickTarget, isUpdate, manualLabels, state.columns, state.results, t, type]);

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
        // 比對不到、撤回比對：問題落在比對目標欄，可以直接在那一格改選
        const targetIssues = rowLevel.filter((issue) => TARGET_ISSUES.has(issue.code));
        if (isUpdate && targetIssues.length) {
          states[TARGET_COLUMN] = {
            tone: 'error',
            message: targetIssues.map((issue) => issueMessage(issue)).join('\n'),
          };
        }
        return {
          key: row.rowNo,
          cells: isUpdate ? { ...row.cells, [TARGET_COLUMN]: targetCell(row) } : row.cells,
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

  /** 比對目標欄的變更：自動比對（清空儲存格也是）、撤回、手動指定；貼上不認得的文字不理會。 */
  const changeTarget = (rowNo: number, value: string) => {
    if (value === TARGET_AUTO || value === '') return workspace.setTarget(rowNo, undefined);
    if (value === TARGET_NONE) return workspace.setTarget(rowNo, null);
    const label = searchedTargets.current.get(value) ?? manualLabels.get(value);
    if (label) workspace.setTarget(rowNo, { id: value, label });
  };

  // 復原／重做的快捷鍵（⌘Z／⌘⇧Z、Ctrl＋Z／Ctrl＋Shift＋Z、Ctrl＋Y）：焦點不在表格時也可以用；
  // 在輸入框裡是瀏覽器原生的文字復原。表格自己處理過的按鍵（defaultPrevented）不會再觸發一次
  const history = useRef({ undo: workspace.undo, redo: workspace.redo });
  useEffect(() => {
    history.current = { undo: workspace.undo, redo: workspace.redo };
  }, [workspace.redo, workspace.undo]);
  useEffect(() => {
    const unregister = [
      registerHotkey({ combo: 'mod+z', run: () => history.current.undo() }),
      registerHotkey({ combo: 'mod+shift+z', run: () => history.current.redo() }),
      ...(isMacPlatform()
        ? []
        : [registerHotkey({ combo: 'mod+y', run: () => history.current.redo() })]),
    ];
    return () => {
      for (const off of unregister) off();
    };
  }, []);
  const counts: Record<Filter, number> = {
    all: summary.total,
    errors: summary.errors,
    warnings: summary.warnings,
    changed: summary.changed,
    unchanged: summary.unchanged,
  };
  const blocked = summary.errors > 0 && !skipInvalid;
  const submitCount = workspace.submittable.length;
  // 有錯誤的列不會寫入：沒勾略過時整批擋下，勾了就略過
  const applyCount = Math.max(0, submitCount - summary.errors);
  const submitStats: Array<{ key: string; label: string; rows: number; tone?: 'danger' }> = [
    {
      key: isUpdate ? 'update' : 'create',
      label: t(isUpdate ? 'dataTransfer.import.submitUpdate' : 'dataTransfer.import.submitCreate'),
      rows: applyCount,
    },
    ...(isUpdate && summary.unchanged > 0
      ? [
          {
            key: 'unchanged',
            label: t('dataTransfer.import.submitUnchanged'),
            rows: summary.unchanged,
          },
        ]
      : []),
    ...(summary.errors > 0
      ? [
          {
            key: 'errors',
            label: t(
              skipInvalid
                ? 'dataTransfer.import.submitSkipped'
                : 'dataTransfer.import.submitErrors',
            ),
            rows: summary.errors,
            tone: 'danger' as const,
          },
        ]
      : []),
  ];

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
          onCellsChange={(changes) => {
            for (const change of changes) {
              const rowNo = rowNoAt(change.rowIndex);
              if (rowNo === undefined || change.key !== TARGET_COLUMN) continue;
              changeTarget(rowNo, change.value);
            }
            workspace.edit(
              changes.flatMap((change) => {
                const rowNo = rowNoAt(change.rowIndex);
                return rowNo === undefined || change.key === TARGET_COLUMN
                  ? []
                  : [{ rowNo, key: change.key, value: change.value }];
              }),
            );
          }}
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
        <div className="flex flex-col gap-4 text-sm text-[var(--color-fg)]">
          {/* 這次會發生什麼：大字的數字，一眼看得出要寫入幾筆、略過幾列 */}
          <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2">
            {submitStats.map((stat) => (
              <div
                key={stat.key}
                className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-fill-subtle)] px-3 py-2"
                data-testid={`import-submit-${stat.key}`}
                data-value={stat.rows}
              >
                <dt className="text-[var(--color-fg-muted)]">{stat.label}</dt>
                <dd
                  className={`m-0 text-xl font-semibold tabular-nums ${stat.tone === 'danger' ? 'text-[var(--color-danger-text)]' : ''}`}
                >
                  {t('dataTransfer.import.submitRows', { rows: stat.rows })}
                </dd>
              </div>
            ))}
          </dl>
          <p className="m-0 leading-relaxed">{t('dataTransfer.import.submitBackground')}</p>
          {summary.errors > 0 && (
            <div className="flex flex-col gap-2">
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
            </div>
          )}
        </div>
      </Dialog>
    </section>
  );
}
