import { Button } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { TableSettings, useTableColumnSettings } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { usePreferenceTables } from '@b2b-system/web-core/preference';
import type { PreferenceTable } from '@b2b-system/web-core/preference';
import {
  ACTIONS_COLUMN_ID,
  ROW_PIN_COLUMN_ID,
  SELECT_COLUMN_ID,
  useTableColumnSettingsStore,
} from '@b2b-system/web-core/store';
import type { PinnedRow } from '@b2b-system/web-core/store';
import { cn } from '@b2b-system/web-shared/utils';
import { useMemo } from 'react';

/**
 * 偏好頁的「表格欄位」分頁：列出 feature 登記過的每張表（`registerPreferenceTable`），
 * 顯示目前的順序、隱藏欄位、固定的欄位、固定表頭與釘選的資料列，並用列表上同一個 `TableSettings` 調整；
 * 釘選的資料列在這裡只能整批清除（釘選本身在列表的操作欄做）。
 */
export function TableColumnsSection() {
  const { t } = useTranslation();
  const tables = usePreferenceTables();

  return (
    <div className="flex flex-col gap-3" data-testid="table-columns-section">
      <p className="m-0 text-sm text-[var(--color-fg-muted)]">
        {t('preference.tableColumns.description')}
      </p>
      {tables.map((table) => (
        <TableColumnsCard key={table.id} table={table} />
      ))}
    </div>
  );
}

const NO_PINNED_ROWS: PinnedRow[] = [];

function TableColumnsCard({ table }: { table: PreferenceTable }) {
  const { t } = useTranslation();
  // 與 RichTable 相同：工具欄（勾選、釘選）排在最前面
  const columns = useMemo(
    () => [
      ...(table.selectable === false
        ? []
        : [{ id: SELECT_COLUMN_ID, label: t('common.selectColumn') }]),
      ...(table.rowPinning === false
        ? []
        : [{ id: ROW_PIN_COLUMN_ID, label: t('common.pinColumn') }]),
      ...Object.entries(table.columnLabelKeys).map(([id, labelKey]) => ({
        id,
        label: t(labelKey),
      })),
    ],
    [table, t],
  );
  // 登記的列表都有操作欄：不列入順序，但可以設定固定在哪一側
  const fixedColumns = useMemo(() => [{ id: ACTIONS_COLUMN_ID, label: t('common.actions') }], [t]);
  const { value, settingsProps } = useTableColumnSettings(
    table.id,
    columns,
    table.defaultHidden,
    fixedColumns,
  );
  const pinnedRows = useTableColumnSettingsStore(
    (state) => state.pinnedRows[table.id] ?? NO_PINNED_ROWS,
  );
  const clearPinnedRows = useTableColumnSettingsStore((state) => state.clearPinnedRows);
  const pinnedColumnCount = Object.keys(value.pinnedColumns).length;
  const customized = useTableColumnSettingsStore((state) => Boolean(state.settings[table.id]));
  const labels = new Map(columns.map((column) => [column.id, column.label]));
  const visibleCount = value.order.length - value.hidden.length;

  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-solid border-[var(--color-border)] p-3"
      data-testid="table-columns-card"
      data-value={table.id}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="m-0 font-medium">{t(table.labelI18nKey)}</p>
          <p className="m-0 text-sm text-[var(--color-fg-muted)]">
            {t('preference.tableColumns.visibleCount', {
              visible: visibleCount,
              total: value.order.length,
            })}
            {' · '}
            {customized
              ? t('preference.tableColumns.customized')
              : t('preference.tableColumns.default')}
          </p>
          <p
            className="m-0 flex flex-wrap items-center gap-x-2 text-sm text-[var(--color-fg-muted)]"
            data-testid="table-columns-pinning"
          >
            <span data-value="columns">
              {t('common.pinnedColumnsSummary', { count: pinnedColumnCount })}
            </span>
            {value.stickyHeader && (
              <span data-value="stickyHeader">{t('common.stickyHeader')}</span>
            )}
            <span data-value="rows">
              {t('common.pinnedRowsSummary', { count: pinnedRows.length })}
            </span>
            {pinnedRows.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => clearPinnedRows(table.id)}
                data-testid="table-columns-clear-pinned-rows"
              >
                {t('common.clearPinnedRows')}
              </Button>
            )}
          </p>
        </div>
        {settingsProps && <TableSettings {...settingsProps} />}
      </div>
      <ol className="m-0 flex list-none flex-wrap gap-1 p-0">
        {value.order.map((id, index) => {
          const hidden = value.hidden.includes(id);
          return (
            <li
              key={id}
              className="rounded-sm border border-solid border-[var(--color-border)] px-2 py-0.5 text-xs"
              data-value={id}
              data-hidden={hidden || undefined}
              data-pin={value.pinnedColumns[id]}
            >
              <span className={cn(hidden && 'text-[var(--color-fg-muted)] line-through')}>
                {index + 1}. {labels.get(id) ?? id}
              </span>
              {value.pinnedColumns[id] && (
                <Icon
                  name={value.pinnedColumns[id] === 'start' ? 'chevron-left' : 'chevron-right'}
                  size={14}
                  aria-label={t(
                    value.pinnedColumns[id] === 'start'
                      ? 'common.pinColumnStart'
                      : 'common.pinColumnEnd',
                    { name: labels.get(id) ?? id },
                  )}
                />
              )}
              {hidden && <span className="sr-only">（{t('preference.tableColumns.hidden')}）</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
