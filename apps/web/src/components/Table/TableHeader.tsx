import { flexRender } from '@tanstack/react-table';
import type { Header, HeaderGroup } from '@tanstack/react-table';

import { Icon } from '../Icon';
import type { SlotResolver } from '../slots';
import type { TableSlot } from './slots';
import { ARIA_SORT, nextSortOrder } from './sorting';
import type { TableSortOrder, TableSorting } from './sorting';

import styles from './Table.module.css';

interface TableHeaderProps<TData> {
  headerGroups: Array<HeaderGroup<TData>>;
  sorting: TableSorting | undefined;
  onSortingChange: ((sortBy: string, sortOrder: TableSortOrder) => void) | undefined;
  slot: SlotResolver<TableSlot>;
}

export function TableHeader<TData>({
  headerGroups,
  sorting,
  onSortingChange,
  slot,
}: TableHeaderProps<TData>) {
  return (
    <thead {...slot('head', styles.head)}>
      {headerGroups.map((headerGroup) => (
        <tr key={headerGroup.id} {...slot('headerRow')}>
          {headerGroup.headers.map((header) => (
            <TableHeaderCell
              key={header.id}
              header={header}
              sorting={sorting}
              onSortingChange={onSortingChange}
              slot={slot}
            />
          ))}
        </tr>
      ))}
    </thead>
  );
}

interface TableHeaderCellProps<TData> extends Omit<TableHeaderProps<TData>, 'headerGroups'> {
  header: Header<TData, unknown>;
}

function TableHeaderCell<TData>({
  header,
  sorting,
  onSortingChange,
  slot,
}: TableHeaderCellProps<TData>) {
  const { column } = header;
  const content = header.isPlaceholder
    ? null
    : flexRender(column.columnDef.header, header.getContext());
  // 沒宣告 size 的欄位交給瀏覽器分配（Table 以 defaultColumn 清掉了 TanStack 的預設 150）
  const width = column.columnDef.size;
  const order = sorting?.sortBy === column.id ? sorting.sortOrder : undefined;

  const cellAttributes = slot('headerCell', styles.headerCell, {
    style: width === undefined ? undefined : { width },
  });

  // 有 onSortingChange 時，除非欄位明確關閉，否則都可排序
  if (!onSortingChange || column.columnDef.enableSorting === false) {
    return <th {...cellAttributes}>{content}</th>;
  }

  return (
    <th {...cellAttributes} data-sortable aria-sort={order ? ARIA_SORT[order] : undefined}>
      {/* 用 <button> 承接點擊，鍵盤（Tab ＋ Enter / Space）才能排序 */}
      <button
        type="button"
        {...slot('sortButton', styles.sortButton)}
        data-order={order}
        onClick={() => onSortingChange(column.id, nextSortOrder(order))}
      >
        {content}
        {order && (
          <Icon name="chevron-down" size={14} {...slot('sortIndicator', styles.sortIndicator)} />
        )}
      </button>
    </th>
  );
}
