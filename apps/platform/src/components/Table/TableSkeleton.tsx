import { Skeleton } from '../Skeleton';
import type { SlotResolver } from '../slots';
import type { TableSlot } from './slots';

import styles from './Table.module.css';

const SKELETON_ROW_COUNT = 5;

interface TableSkeletonProps {
  columnCount: number;
  slot: SlotResolver<TableSlot>;
}

/** 骨架列只套 class 與 style，不帶 testid：E2E 數 `table-row` 時不能把它算進去。 */
export function TableSkeleton({ columnCount, slot }: TableSkeletonProps) {
  const { className: rowClassName, style: rowStyle } = slot('row', styles.row);
  const { className: cellClassName, style: cellStyle } = slot('cell', styles.cell);

  return (
    <>
      {Array.from({ length: SKELETON_ROW_COUNT }, (_row, rowIndex) => (
        <tr key={rowIndex} className={rowClassName} style={rowStyle}>
          {Array.from({ length: columnCount }, (_cell, columnIndex) => (
            <td key={columnIndex} className={cellClassName} style={cellStyle}>
              <Skeleton height={14} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
