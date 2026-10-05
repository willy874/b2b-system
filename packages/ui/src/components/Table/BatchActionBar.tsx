import { cn } from '@b2b-system/web-shared/utils';
import type { ReactNode, Ref } from 'react';

import { Button } from '../Button';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './BatchActionBar.module.css';

/** `className` 落在根元素（`role="toolbar"`）；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type BatchActionBarSlot = 'count' | 'actions' | 'clear';

export interface BatchActionBarProps extends SlotOverrides<BatchActionBarSlot> {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  /** 目前選取的筆數（跨頁）。 */
  count: number;
  /** 「清除選取」按鈕。 */
  onClear: () => void;
  /** 批次操作的按鈕，由呼叫端決定（本元件不認識任何業務操作）。 */
  children?: ReactNode;
  /** `components/` 不依賴語系：預設文案寫死，`features/` 使用時以 `t()` 傳入。 */
  labels?: {
    count?: (count: number) => string;
    clear?: string;
    /** 工具列的可存取名稱。 */
    toolbar?: string;
  };
  className?: string;
  'data-testid'?: string;
}

/**
 * 表格勾選後出現的批次操作列：顯示已選筆數、清除選取，並放入呼叫端的操作按鈕。
 * 選取狀態通常來自 `useTableSelection`（跨頁保留）。
 */
export function BatchActionBar({
  count,
  onClear,
  children,
  labels,
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: BatchActionBarProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  return (
    <div
      role="toolbar"
      aria-label={labels?.toolbar ?? '批次操作'}
      className={cn(styles.root, className)}
      data-testid="batch-action-bar"
      {...rest}
    >
      <span
        aria-live="polite"
        {...slot('count', styles.count, { testId: 'batch-action-bar-count' })}
        data-value={count}
      >
        {labels?.count ? labels.count(count) : `已選取 ${count} 筆`}
      </span>
      <div {...slot('actions', styles.actions)}>{children}</div>
      <Button
        size="sm"
        variant="ghost"
        onClick={onClear}
        {...slot('clear', undefined, { testId: 'batch-action-bar-clear' })}
      >
        {labels?.clear ?? '清除選取'}
      </Button>
    </div>
  );
}
