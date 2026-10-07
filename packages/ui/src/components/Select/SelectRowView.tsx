import { memo } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react';

import { Icon } from '../Icon';
import type { SlotResolver } from '../slots';
import { withRowPosition } from '../VirtualList';
import type { CheckState, SelectRow } from './selectModel';
import type { SelectSlot } from './selectSlots';

import styles from './Select.module.css';

interface SelectRowViewProps<T extends string> {
  row: SelectRow<T>;
  index: number;
  id: string;
  start: number | undefined;
  isActive: boolean;
  isDisabled: boolean;
  isExpanded: boolean;
  state: CheckState;
  isMultiple: boolean;
  isTree: boolean;
  /** 單選時群組列也是值（`selectableGroups`）。 */
  isGroupSelectable: boolean;
  label: ReactNode;
  description: ReactNode;
  slot: SlotResolver<SelectSlot>;
  measureElement: ((element: Element | null) => void) | undefined;
  onPick: (index: number) => void;
  onToggleExpand: (index: number) => void;
  onHover: (index: number) => void;
}

/**
 * 一列。以 `memo` 包住，所有 callback 都是固定參考：
 * 勾選一個項目時只有狀態改變的列（該列、它的祖先群組、全選列）重新 render。
 * 勾選框常駐、只換 `data-state`，列的寬高不會因為勾選而改變。
 */
export const SelectRowView = memo(function SelectRowView<T extends string>({
  row,
  index,
  id,
  start,
  isActive,
  isDisabled,
  isExpanded,
  state,
  isMultiple,
  isTree,
  isGroupSelectable,
  label,
  description,
  slot,
  measureElement,
  onPick,
  onToggleExpand,
  onHover,
}: SelectRowViewProps<T>) {
  const isGroup = row.kind === 'option' && row.isGroup;
  const depth = row.kind === 'option' ? row.depth : 0;
  const item = slot('item', styles.item, { testId: 'select-item' });
  const style = { ...item.style, '--select-depth': depth } as CSSProperties;
  return (
    // 鍵盤操作在列表容器上（aria-activedescendant），列本身只接滑鼠；role 依是否為樹而定，lint 無法靜態判斷
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      id={id}
      ref={measureElement}
      role={isTree ? 'treeitem' : 'option'}
      aria-selected={isGroup && !isMultiple && !isGroupSelectable ? undefined : state === 'checked'}
      aria-checked={isMultiple && state === 'indeterminate' ? 'mixed' : undefined}
      aria-disabled={isDisabled || undefined}
      aria-expanded={isGroup ? isExpanded : undefined}
      aria-level={isTree ? depth + 1 : undefined}
      className={item.className}
      style={withRowPosition(style, start)}
      data-testid={item['data-testid']}
      data-index={index}
      data-value={row.key}
      data-kind={row.kind === 'all' ? 'all' : isGroup ? 'group' : 'option'}
      data-state={state}
      data-selected={state === 'checked' || undefined}
      data-highlighted={isActive || undefined}
      data-disabled={isDisabled || undefined}
      data-described={description ? true : undefined}
      onClick={() => {
        if (!isDisabled) onPick(index);
      }}
      // 用 pointermove 而不是 pointerenter：列表捲動經過靜止的游標時不會亂換作用列
      onPointerMove={() => {
        if (!isActive) onHover(index);
      }}
    >
      {isTree && (
        // listbox / tree 裡不能再放可聚焦的按鈕；鍵盤以 ←／→ 展開收合，這裡只接滑鼠點擊
        <span
          aria-hidden
          {...slot('expander', styles.expander)}
          data-expanded={isExpanded || undefined}
          onClick={(event: ReactMouseEvent) => {
            if (!isGroup) return;
            event.stopPropagation();
            onToggleExpand(index);
          }}
        >
          {isGroup && <Icon name="chevron-right" size={14} />}
        </span>
      )}
      {isMultiple ? (
        <span aria-hidden {...slot('indicator', styles.checkbox)} data-state={state}>
          <Icon name={state === 'indeterminate' ? 'minus' : 'check'} size={14} />
        </span>
      ) : (
        <span aria-hidden {...slot('indicator', styles.indicator)} data-state={state}>
          <Icon name="check" size={14} />
        </span>
      )}
      <span {...slot('itemText', styles.itemText)}>
        <span className={styles.itemLabel}>{label}</span>
        {description && (
          <span {...slot('itemDescription', styles.itemDescription)}>{description}</span>
        )}
      </span>
    </div>
  );
}) as <T extends string>(props: SelectRowViewProps<T>) => ReactNode;
