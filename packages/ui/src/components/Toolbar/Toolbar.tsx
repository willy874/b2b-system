import { cn } from '@b2b-system/web-shared/utils';
import { useState } from 'react';
import type { HTMLAttributes, KeyboardEvent, ReactNode, Ref } from 'react';

import { Button, IconButton } from '../Button';
import type { ButtonSize, ButtonVariant } from '../Button';
import { useComposedRef } from '../Ellipsis/useEllipsis';
import { fitIndices, useFitItems } from '../Ellipsis/useFitItems';
import { Icon } from '../Icon';
import { Menu } from '../Menu';
import type { MenuItemDescriptor } from '../Menu';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';
import { Tooltip } from '../Tooltip';

import styles from './Toolbar.module.css';

export interface ToolbarItem {
  key: string;
  /** 按鈕文字；只顯示圖示時作為無障礙名稱與提示內容，收進下拉時作為選項文字。 */
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** 覆寫整列的 `variant`；`danger` 在下拉選單中顯示為危險色。 */
  variant?: ButtonVariant;
  /** 按鈕的說明提示（例如為何停用）；只顯示圖示時預設為 `label`。 */
  tooltip?: ReactNode;
  /** 這顆按鈕只顯示圖示（沒有 `icon` 時仍顯示文字）。 */
  iconOnly?: boolean;
  /** `end`：排在工具列右側（從第一個 `end` 項目起靠右）。預設 `start`。 */
  align?: 'start' | 'end';
  /** 覆寫這顆按鈕的 `data-testid`（預設 `toolbar-item`）；`data-value` 一律是 `key`。 */
  'data-testid'?: string;
}

/**
 * `className` / `data-testid` 落在工具列（`role="toolbar"`）。
 * `item`：顯示在外面的每顆按鈕；`more`：展開下拉的按鈕；`menuItem`：下拉裡的每個選項。
 */
export type ToolbarSlot = 'item' | 'more' | 'menuItem';

export interface ToolbarProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children'>, SlotOverrides<ToolbarSlot> {
  /** 透傳到工具列（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  items: ToolbarItem[];
  /** 整列的預設外觀；個別項目可用 `item.variant` 覆寫。預設 `ghost`。 */
  variant?: ButtonVariant;
  /** 預設 `sm`。 */
  size?: ButtonSize;
  /**
   * 整列只顯示圖示（沒有圖示的項目仍顯示文字）。
   * `true`：一律；數字：工具列寬度小於此 px 時。先縮成圖示，仍放不下的才收進下拉。
   */
  iconOnly?: boolean | number;
  /** 依寬度把放不下的按鈕從尾端收進「更多」下拉。預設 `true`。 */
  fit?: boolean;
  /** 下拉按鈕的無障礙名稱。預設「更多」；`features/` 使用時以 `t()` 傳入。 */
  moreLabel?: string;
}

const NAVIGATION_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

/** 方向鍵在工具列的按鈕之間移動焦點（docs/architecture/frontend/07-ui-system.md §3.14）。 */
function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (!NAVIGATION_KEYS.has(event.key)) return;
  const root = event.currentTarget;
  // 下拉選單是 portal：React 事件會冒泡上來，但 DOM 上不在工具列裡，交還給選單自己處理
  if (!(event.target instanceof Node) || !root.contains(event.target)) return;
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  const current = buttons.findIndex((button) => button === document.activeElement);
  if (current < 0) return;
  const last = buttons.length - 1;
  const next = {
    ArrowLeft: current === 0 ? last : current - 1,
    ArrowRight: current === last ? 0 : current + 1,
    Home: 0,
    End: last,
  }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  buttons[next]?.focus();
}

/**
 * 一列操作按鈕（`role="toolbar"`）：放不下的按鈕從尾端收進「更多」下拉選單，容器縮放時跟著重算；
 * 可再設定 `iconOnly`，空間變小時先縮成只剩圖示。
 */
export function Toolbar({
  ref,
  items,
  variant = 'ghost',
  size = 'sm',
  iconOnly = false,
  fit = true,
  moreLabel = '更多',
  onKeyDown,
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: ToolbarProps) {
  const [width, setWidth] = useState(0);
  const isIconOnly = typeof iconOnly === 'number' ? width > 0 && width < iconOnly : iconOnly;
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });

  const { attachRoot, attachItem, attachOverflow, isMeasuring, visible } = useFitItems({
    // 只剩圖示時按鈕寬度會變，要重新量
    signature: `${items.map((item) => item.key).join('|')}#${String(isIconOnly)}`,
    count: items.length,
    enabled: fit,
    onWidthChange: setWidth,
    pick: ({ widths, overflowWidth, gap, available }) =>
      !fit || available <= 0
        ? items.map((_, index) => index)
        : fitIndices(widths, overflowWidth, gap, available),
  });
  const composedRef = useComposedRef<HTMLDivElement>(ref, attachRoot);

  const visibleItems = visible.flatMap((index) => {
    const item = items[index];
    return item ? [{ item, index }] : [];
  });
  const hiddenItems = isMeasuring ? items : items.slice(visibleItems.length);
  // 第一個 `end` 項目推到右側；全部 `end` 項目都收起時改由「更多」靠右
  const firstEnd = visibleItems.find(({ item }) => item.align === 'end')?.index;

  const renderItem = (item: ToolbarItem, index: number) => {
    const showIconOnly = (isIconOnly || item.iconOnly) && item.icon !== undefined;
    const itemSlot = slot('item', styles.item, { testId: 'toolbar-item' });
    const attributes = {
      ...itemSlot,
      ref: attachItem(index),
      'data-testid': item['data-testid'] ?? itemSlot['data-testid'],
      'data-value': item.key,
      'data-push': index === firstEnd || undefined,
      variant: item.variant ?? variant,
      size,
      disabled: item.disabled,
      loading: item.loading,
      onClick: item.onClick,
    };
    const button = showIconOnly ? (
      <IconButton aria-label={item.label} {...attributes}>
        {item.icon}
      </IconButton>
    ) : (
      <Button startIcon={item.icon} {...attributes}>
        {item.label}
      </Button>
    );
    return (
      <Tooltip key={item.key} content={item.tooltip ?? (showIconOnly ? item.label : undefined)}>
        {button}
      </Tooltip>
    );
  };

  const toMenuItem = (item: ToolbarItem): MenuItemDescriptor => ({
    key: item.key,
    textValue: item.label,
    label: (
      <span className={styles.menuLabel}>
        {item.icon}
        {item.label}
      </span>
    ),
    disabled: item.disabled || item.loading,
    tone: (item.variant ?? variant) === 'danger' ? 'danger' : 'default',
    onSelect: item.onClick,
  });

  return (
    // 焦點落在裡面的按鈕上，方向鍵是從按鈕冒泡上來的；工具列本身不需要可聚焦
    // oxlint-disable-next-line jsx-a11y/interactive-supports-focus
    <div
      ref={composedRef}
      role="toolbar"
      aria-orientation="horizontal"
      className={cn(styles.root, className)}
      data-overflowing={(!isMeasuring && hiddenItems.length > 0) || undefined}
      onKeyDown={(event) => {
        moveFocus(event);
        onKeyDown?.(event);
      }}
      {...rest}
    >
      {visibleItems.map(({ item, index }) => renderItem(item, index))}
      {hiddenItems.length > 0 && (
        <div
          ref={attachOverflow}
          className={styles.overflow}
          data-push={firstEnd === undefined || undefined}
        >
          <Menu
            align="end"
            trigger={
              <IconButton
                aria-label={moreLabel}
                variant={variant}
                size={size}
                {...slot('more', undefined, { testId: 'toolbar-more' })}
              >
                <Icon name="more" size={16} />
              </IconButton>
            }
            items={hiddenItems.map(toMenuItem)}
            classNames={{ item: classNames?.menuItem }}
            styles={{ item: styleOverrides?.menuItem }}
            testIds={{ item: testIds?.menuItem }}
          />
        </div>
      )}
    </div>
  );
}
