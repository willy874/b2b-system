import { flexRender } from '@tanstack/react-table';
import type { Row } from '@tanstack/react-table';
import type { MouseEvent } from 'react';

import type { SlotResolver } from '../slots';
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
export function TableRow<TData>({ row, selectable, onDoubleClick, slot }: TableRowProps<TData>) {
  const handleClick = (event: MouseEvent<HTMLTableRowElement>) => {
    if (!selectable || isFromInteractiveElement(event)) return;
    row.toggleSelected();
  };

  const handleDoubleClick = (event: MouseEvent<HTMLTableRowElement>) => {
    if (!onDoubleClick || isFromInteractiveElement(event)) return;
    onDoubleClick(row.original);
  };

  return (
    <tr
      {...slot('row', styles.row, { testId: 'table-row' })}
      data-value={row.id}
      data-selected={row.getIsSelected() || undefined}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {row.getVisibleCells().map((cell) => (
        <td key={cell.id} {...slot('cell', styles.cell)}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );
}
