import { flexRender } from '@tanstack/react-table';
import type { Row } from '@tanstack/react-table';
import { Fragment } from 'react';
import type { MouseEvent, ReactNode } from 'react';

import type { SlotResolver } from '../slots';
import { getPinnedCellProps } from './pinning';
import type { PinLayout, RowPin } from './pinning';
import type { TableSlot } from './slots';

import styles from './Table.module.css';

/** 列內可以自己處理點擊的元素；點在它們上面時，列本身不反應。 */
const INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, label, [role="button"], [role="checkbox"], [role="menuitem"]';

function isFromInteractiveElement(event: MouseEvent<HTMLElement>): boolean {
  if (!(event.target instanceof Element)) return false;
  const interactive = event.target.closest(INTERACTIVE_SELECTOR);
  return interactive !== null && event.currentTarget.contains(interactive);
}

interface TableRowProps<TData> {
  row: Row<TData>;
  /** 釘選的列：貼在頂端或底端（sticky），交界的那一列畫分隔線。 */
  pin?: RowPin;
  pinLayout: PinLayout;
  /** 有值時在這一列正下方插入一列橫跨所有欄位的展開內容。 */
  expandedContent?: ReactNode;
  /** 已進入選取模式（至少勾選一列）時，單擊列身切換選取。 */
  selectable: boolean;
  onDoubleClick: ((row: TData) => void) | undefined;
  slot: SlotResolver<TableSlot>;
}

/**
 * 列的點擊行為（docs/architecture/frontend/07-ui-system.md §6）：
 * 單擊只在選取模式下切換選取、雙擊開詳情；點在列內的按鈕、連結、勾選框上只觸發該元件，
 * 呼叫端不必在每個按鈕上 `stopPropagation`。
 */
export function TableRow<TData>({
  row,
  pin,
  pinLayout,
  expandedContent,
  selectable,
  onDoubleClick,
  slot,
}: TableRowProps<TData>) {
  const handleClick = (event: MouseEvent<HTMLTableRowElement>) => {
    if (!selectable || isFromInteractiveElement(event)) return;
    row.toggleSelected();
  };

  const handleDoubleClick = (event: MouseEvent<HTMLTableRowElement>) => {
    if (!onDoubleClick || isFromInteractiveElement(event)) return;
    onDoubleClick(row.original);
  };

  const cells = [
    ...row.getLeftVisibleCells(),
    ...row.getCenterVisibleCells(),
    ...row.getRightVisibleCells(),
  ];
  const isExpanded = expandedContent !== undefined;

  return (
    <Fragment>
      <tr
        {...slot('row', styles.row, { testId: 'table-row' })}
        data-value={row.id}
        data-selected={row.getIsSelected() || undefined}
        data-pinned-row={pin?.side}
        data-pinned-row-edge={pin?.edge || undefined}
        data-expanded={isExpanded || undefined}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {/* 與表頭（getHeaderGroups）同樣依「左固定 → 其餘 → 右固定」排列 */}
        {cells.map((cell) => {
          const { style: columnStyle, ...pinnedAttributes } = getPinnedCellProps(
            cell.column,
            pinLayout,
          );
          // sticky 放在儲存格上（<tr> 的 sticky 在部分瀏覽器無效）
          const style = pin ? { ...columnStyle, [pin.side]: pin.offset } : columnStyle;
          return (
            <td key={cell.id} {...slot('cell', styles.cell, { style })} {...pinnedAttributes}>
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </td>
          );
        })}
      </tr>
      {isExpanded && (
        <tr
          {...slot('expandedRow', styles.expandedRow, { testId: 'table-expanded-row' })}
          data-value={row.id}
        >
          <td {...slot('expandedCell', styles.expandedCell)} colSpan={cells.length}>
            {expandedContent}
          </td>
        </tr>
      )}
    </Fragment>
  );
}
