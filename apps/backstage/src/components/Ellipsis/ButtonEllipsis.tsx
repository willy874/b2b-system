import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { Button, IconButton } from '../Button';
import type { ButtonSize, ButtonVariant } from '../Button';
import { Icon } from '../Icon';
import { Menu } from '../Menu';
import type { MenuItemDescriptor } from '../Menu';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';
import { Tooltip } from '../Tooltip';
import { BoxEllipsis } from './BoxEllipsis';
import type { BoxEllipsisMaxVisible, BoxEllipsisProps } from './BoxEllipsis';

export interface ButtonEllipsisItem {
  key: string;
  /** 按鈕文字；只剩圖示時作為無障礙名稱與提示內容，收進下拉時作為選項文字。 */
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** 覆寫整組的 `variant`；`danger` 在下拉選單中顯示為危險色。 */
  variant?: ButtonVariant;
  /** 按鈕的說明提示（例如為何停用）；只剩圖示時預設為 `label`。 */
  tooltip?: ReactNode;
  /** 覆寫這顆按鈕的 `data-testid`（預設 `button-ellipsis-item` ＋ `data-value={key}`）。 */
  'data-testid'?: string;
}

/**
 * `className` / `data-testid` 落在容器。
 * `button`：顯示在外面的每顆按鈕；`more`：展開下拉的按鈕；`menuItem`：下拉裡的每個選項。
 */
export type ButtonEllipsisSlot = 'button' | 'more' | 'menuItem';

/** 沿用 `BoxEllipsis` 的容器屬性（className、data-testid、ref、maxVisible、fit …）。 */
type ContainerProps = Omit<
  BoxEllipsisProps,
  | 'children'
  | 'renderOverflow'
  | 'overflowTooltip'
  | 'measureKey'
  | 'classNames'
  | 'styles'
  | 'testIds'
>;

export interface ButtonEllipsisProps extends ContainerProps, SlotOverrides<ButtonEllipsisSlot> {
  items: ButtonEllipsisItem[];
  /** 整組的預設外觀；個別項目可用 `item.variant` 覆寫。預設 `secondary`。 */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 最多顯示幾顆按鈕，其餘收進下拉（隱藏判斷點）；可依容器寬度決定。 */
  maxVisible?: BoxEllipsisMaxVisible;
  /**
   * 按鈕只顯示圖示（沒有圖示的項目仍顯示文字）。
   * `true`：一律；數字：容器寬度小於此 px 時。先縮成圖示，仍放不下的才收進下拉。
   */
  iconOnly?: boolean | number;
  /** 下拉按鈕的無障礙名稱。預設「更多」；`features/` 使用時以 `t()` 傳入。 */
  moreLabel?: string;
  /** 下拉按鈕的圖示。預設為三個點。 */
  moreIcon?: ReactNode;
  /** 自訂下拉按鈕（隱藏替代節點），會收到被收進下拉的項目；必須是可接收 ref 的元素。 */
  renderMoreTrigger?: (hiddenItems: ButtonEllipsisItem[]) => ReactElement<Record<string, unknown>>;
  /** 下拉選單對齊下拉按鈕的哪一側。預設 `end`。 */
  menuAlign?: 'start' | 'center' | 'end';
  /** 下拉選單（popup）的 class。 */
  menuClassName?: string;
}

/**
 * 一組操作按鈕：放不下（或超過 `maxVisible`）的按鈕從尾端收進「更多」下拉選單。
 * 可再設定 `iconOnly`，空間變小時先縮成只剩圖示。
 */
export function ButtonEllipsis({
  items,
  variant = 'secondary',
  size = 'md',
  iconOnly = false,
  moreLabel = '更多',
  moreIcon,
  renderMoreTrigger,
  menuAlign = 'end',
  menuClassName,
  onWidthChange,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: ButtonEllipsisProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const isIconOnly =
    typeof iconOnly === 'number' ? containerWidth > 0 && containerWidth < iconOnly : iconOnly;
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });

  const renderButton = (item: ButtonEllipsisItem) => {
    const showIconOnly = isIconOnly && item.icon !== undefined;
    const buttonSlot = slot('button', undefined, { testId: 'button-ellipsis-item' });
    const attributes = {
      ...buttonSlot,
      'data-testid': item['data-testid'] ?? buttonSlot['data-testid'],
      'data-value': item.key,
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

  const toMenuItem = (item: ButtonEllipsisItem): MenuItemDescriptor => ({
    key: item.key,
    label: (
      <>
        {item.icon}
        {item.label}
      </>
    ),
    disabled: item.disabled || item.loading,
    tone: (item.variant ?? variant) === 'danger' ? 'danger' : 'default',
    onSelect: item.onClick,
  });

  return (
    <BoxEllipsis
      {...rest}
      measureKey={isIconOnly}
      onWidthChange={(width) => {
        setContainerWidth(width);
        onWidthChange?.(width);
      }}
      renderOverflow={({ visibleCount }) => {
        const hiddenItems = items.slice(visibleCount);
        const trigger = renderMoreTrigger?.(hiddenItems) ?? (
          <IconButton
            aria-label={moreLabel}
            variant={variant}
            size={size}
            {...slot('more', undefined, { testId: 'button-ellipsis-more' })}
          >
            {moreIcon ?? <Icon name="more" size={16} />}
          </IconButton>
        );
        return (
          <Menu
            trigger={trigger}
            items={hiddenItems.map(toMenuItem)}
            align={menuAlign}
            className={menuClassName}
            classNames={{ item: classNames?.menuItem }}
            styles={{ item: styleOverrides?.menuItem }}
            testIds={{ item: testIds?.menuItem }}
          />
        );
      }}
    >
      {items.map(renderButton)}
    </BoxEllipsis>
  );
}
