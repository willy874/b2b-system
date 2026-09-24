import { useMemo } from 'react';

import { TableSettings, useTableColumnSettings } from '@/core/components';
import { useTranslation } from '@/core/locales';
import { getPreferenceTables } from '@/core/preference';
import type { PreferenceTable } from '@/core/preference';
import { useTableColumnSettingsStore } from '@/core/store';
import { cn } from '@/shared/utils';

/**
 * 偏好頁的「表格欄位」分頁：列出 feature 登記過的每張表（`registerPreferenceTable`），
 * 顯示目前的順序與隱藏欄位，並用列表上同一個 `TableSettings` 調整。
 */
export function TableColumnsSection() {
  const { t } = useTranslation();
  const tables = getPreferenceTables();

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

function TableColumnsCard({ table }: { table: PreferenceTable }) {
  const { t } = useTranslation();
  const columns = useMemo(
    () =>
      Object.entries(table.columnLabelKeys).map(([id, labelKey]) => ({ id, label: t(labelKey) })),
    [table, t],
  );
  const { value, settingsProps } = useTableColumnSettings(table.id, columns);
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
              data-hidden={hidden || undefined}
            >
              <span className={cn(hidden && 'text-[var(--color-fg-muted)] line-through')}>
                {index + 1}. {labels.get(id) ?? id}
              </span>
              {hidden && <span className="sr-only">（{t('preference.tableColumns.hidden')}）</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
