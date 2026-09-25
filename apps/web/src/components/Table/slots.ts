/** `className` 落在最外層容器；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type TableSlot =
  | 'table'
  | 'head'
  | 'headerRow'
  | 'headerCell'
  | 'headerInner'
  | 'headerLabel'
  | 'headerTrailing'
  | 'sortButton'
  | 'sortLabel'
  | 'sortIndicator'
  | 'sortPriority'
  | 'body'
  | 'row'
  | 'cell'
  | 'expandedRow'
  | 'expandedCell'
  | 'empty';
