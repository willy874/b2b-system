import type { RowData } from '@tanstack/react-table';
import { createContext, useContext } from 'react';

import { IconButton } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Menu } from '@/components/Menu';
import { UTILITY_COLUMN_SIZE } from '@/components/Table';
import type { TableCellContext, TableColumnDef } from '@/components/Table';
import { Tooltip } from '@/components/Tooltip';
import { useTranslation } from '@/core/locales';
import { ROW_PIN_COLUMN_ID } from '@/core/store';
import type { RowPinSide } from '@/core/store';

interface RowPinContextValue {
  /** 列 id → 釘選在哪一側。 */
  pinned: ReadonlyMap<string, RowPinSide>;
  pin: (id: string, side: RowPinSide, row: unknown) => void;
  unpin: (id: string) => void;
}

/**
 * 釘選狀態由 context 傳入，而不是做進欄位定義：TanStack 的 `flexRender` 把函式儲存格當成元件，
 * 每次釘選都換一個新函式會讓整欄重新掛載（按鈕的 Tooltip、焦點都會遺失）。
 */
export const RowPinContext = createContext<RowPinContextValue>({
  pinned: new Map(),
  pin: () => {},
  unpin: () => {},
});

/** 釘選欄（PinColumn）：每一列一個釘選選單（頂端／底端／取消）。 */
function RowPinCell<TData extends RowData>({ row }: TableCellContext<TData>) {
  const { t } = useTranslation();
  const { pinned, pin, unpin } = useContext(RowPinContext);
  const side = pinned.get(row.id);
  const label = side ? t('common.unpinRow') : t('common.pinRow');

  return (
    <Menu
      align="start"
      items={[
        {
          key: 'top',
          label: t('common.pinRowTop'),
          disabled: side === 'top',
          onSelect: () => pin(row.id, 'top', row.original),
        },
        {
          key: 'bottom',
          label: t('common.pinRowBottom'),
          disabled: side === 'bottom',
          onSelect: () => pin(row.id, 'bottom', row.original),
        },
        ...(side
          ? [{ key: 'unpin', label: t('common.unpinRow'), onSelect: () => unpin(row.id) }]
          : []),
      ]}
      testIds={{ item: 'table-row-pin-option' }}
      trigger={
        <IconButton
          size="sm"
          aria-label={t('common.pinRow')}
          aria-pressed={Boolean(side)}
          data-pin={side}
          data-testid="table-row-pin"
        >
          <Tooltip content={label}>
            <Icon name={side ? 'pin-off' : 'pin'} size={16} />
          </Tooltip>
        </IconButton>
      }
    />
  );
}

/**
 * 釘選欄（PinColumn）：獨立一欄，預設隱藏（`DEFAULT_HIDDEN_COLUMNS`），在欄位設定裡打開。
 * 釘選狀態由 `RowPinContext` 提供；`label` 是欄位設定裡的名稱。
 */
export function createPinColumn<TData extends RowData>(label: string): TableColumnDef<TData> {
  return {
    id: ROW_PIN_COLUMN_ID,
    size: UTILITY_COLUMN_SIZE,
    enableSorting: false,
    meta: { settingsLabel: label },
    header: () => <span className="sr-only">{label}</span>,
    cell: RowPinCell,
  };
}
