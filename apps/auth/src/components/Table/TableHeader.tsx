import { flexRender } from '@tanstack/react-table';
import type { Header, HeaderGroup, RowData } from '@tanstack/react-table';
import type { ReactNode } from 'react';

import { Icon } from '../Icon';
import type { SlotResolver } from '../slots';
import type { TableFeatureSet } from './features';
import { getPinnedCellProps } from './pinning';
import type { PinLayout } from './pinning';
import type { TableSlot } from './slots';
import { ARIA_SORT, SORT_ICON, toggleSorting } from './sorting';
import type { TableSorting } from './sorting';

import styles from './Table.module.css';

interface TableHeaderProps<TData extends RowData> {
  headerGroups: Array<HeaderGroup<TableFeatureSet, TData>>;
  sorting: readonly TableSorting[];
  onSortingChange: ((sorting: TableSorting[]) => void) | undefined;
  /** 固定在最後一欄表頭右側、與標題垂直置中的內容。 */
  trailing: ReactNode;
  pinLayout: PinLayout;
  slot: SlotResolver<TableSlot>;
}

export function TableHeader<TData extends RowData>({
  headerGroups,
  sorting,
  onSortingChange,
  trailing,
  pinLayout,
  slot,
}: TableHeaderProps<TData>) {
  return (
    <thead {...slot('head', styles.head)}>
      {headerGroups.map((headerGroup) => (
        <tr key={headerGroup.id} {...slot('headerRow')}>
          {headerGroup.headers.map((header, index) => (
            <TableHeaderCell
              key={header.id}
              header={header}
              sorting={sorting}
              onSortingChange={onSortingChange}
              trailing={index === headerGroup.headers.length - 1 ? trailing : undefined}
              pinLayout={pinLayout}
              slot={slot}
            />
          ))}
        </tr>
      ))}
    </thead>
  );
}

interface TableHeaderCellProps<TData extends RowData> extends Omit<
  TableHeaderProps<TData>,
  'headerGroups'
> {
  header: Header<TableFeatureSet, TData, unknown>;
}

function TableHeaderCell<TData extends RowData>({
  header,
  sorting,
  onSortingChange,
  trailing,
  pinLayout,
  slot,
}: TableHeaderCellProps<TData>) {
  const { column } = header;
  const content = header.isPlaceholder
    ? null
    : flexRender(column.columnDef.header, header.getContext());
  // 沒宣告 size 的欄位交給瀏覽器分配（Table 以 defaultColumn 清掉了 TanStack 的預設 150）
  const width = column.columnDef.size;
  const index = sorting.findIndex((entry) => entry.sortBy === column.id);
  const order = index === -1 ? undefined : sorting[index]!.sortOrder;

  const { style: pinnedStyle, ...pinnedAttributes } = getPinnedCellProps(column, pinLayout);
  const cellAttributes = slot('headerCell', styles.headerCell, {
    style: width === undefined && !pinnedStyle ? undefined : { width, ...pinnedStyle },
  });

  // 有 onSortingChange 時，除非欄位明確關閉，否則都可排序
  const sortable = Boolean(onSortingChange) && column.columnDef.enableSorting !== false;
  const label = (
    <span {...slot('headerLabel', styles.headerLabel)}>
      {sortable ? (
        <SortButton
          sorting={sorting}
          columnId={column.id}
          index={index}
          onSortingChange={onSortingChange!}
          slot={slot}
        >
          {content}
        </SortButton>
      ) : (
        content
      )}
    </span>
  );

  return (
    <th
      {...cellAttributes}
      {...pinnedAttributes}
      data-column-id={column.id}
      data-sortable={sortable || undefined}
      aria-sort={sortable && order ? ARIA_SORT[order] : undefined}
    >
      {trailing ? (
        // 標題吃剩下的寬度，被擠壓時裁掉（overflow hidden）；trailing 固定在右側、不縮，兩者垂直置中
        <div {...slot('headerInner', styles.headerInner)}>
          {label}
          <span {...slot('headerTrailing', styles.headerTrailing)}>{trailing}</span>
        </div>
      ) : (
        label
      )}
    </th>
  );
}

interface SortButtonProps extends Pick<TableHeaderCellProps<RowData>, 'sorting' | 'slot'> {
  columnId: string;
  /** 這一欄在 `sorting` 裡的位置；-1 表示未排序。 */
  index: number;
  onSortingChange: (sorting: TableSorting[]) => void;
  children: ReactNode;
}

function SortButton({
  sorting,
  columnId,
  index,
  onSortingChange,
  slot,
  children,
}: SortButtonProps) {
  const order = index === -1 ? undefined : sorting[index]!.sortOrder;
  return (
    // 用 <button> 承接點擊，鍵盤（Tab ＋ Enter / Space）才能排序
    <button
      type="button"
      {...slot('sortButton', styles.sortButton)}
      data-order={order}
      onClick={() => onSortingChange(toggleSorting(sorting, columnId))}
    >
      <span {...slot('sortLabel', styles.sortLabel)}>{children}</span>
      <Icon
        name={SORT_ICON[order ?? 'none']}
        size={14}
        {...slot('sortIndicator', styles.sortIndicator)}
      />
      {/* 優先順序；方向與是否排序已由 aria-sort 表達，數字只給視覺 */}
      {order && (
        <span aria-hidden {...slot('sortPriority', styles.sortPriority)}>
          {index + 1}
        </span>
      )}
    </button>
  );
}
