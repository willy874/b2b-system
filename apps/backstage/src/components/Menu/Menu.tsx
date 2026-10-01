import { Popover as BasePopover } from '@base-ui/react/popover';
import { cloneElement, memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactElement,
  ReactNode,
} from 'react';

import { cn } from '@/shared/utils';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';
import { Spinner } from '../Spinner';
import { useControllableState } from '../useControllableState';
import { useLatestRef } from '../useLatestRef';
import {
  useInfiniteScroll,
  useListNavigation,
  useVirtualRows,
  withRowPosition,
} from '../VirtualList';

import styles from './Menu.module.css';

export interface MenuItemDescriptor {
  key: string;
  label: ReactNode;
  /** 鍵盤 typeahead 比對用的文字；`label` 是字串時可省略。 */
  textValue?: string;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  onSelect?: () => void;
  /** 需要渲染成連結時傳入元素（例如 TanStack Router 的 Link）。 */
  render?: ReactElement<Record<string, unknown>>;
}

/** `className` 落在選單（popup）；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type MenuSlot = 'positioner' | 'list' | 'item' | 'footer';

export interface MenuProps extends SlotOverrides<MenuSlot> {
  trigger: ReactElement<Record<string, unknown>>;
  items: MenuItemDescriptor[];
  align?: 'start' | 'center' | 'end';
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 無限捲動：還有下一頁。 */
  hasMore?: boolean;
  /** 無限捲動：正在載入下一頁（底部顯示載入中）。 */
  loading?: boolean;
  /** 無限捲動：捲到接近底部（或內容不滿一屏）時呼叫。 */
  onLoadMore?: () => void;
  loadingLabel?: string;
  /** 沒有任何項目、也不在載入中時顯示。 */
  emptyLabel?: ReactNode;
  /** 項目數超過這個值才虛擬捲動。預設 100。 */
  virtualThreshold?: number;
  /** 列高（px），要與 CSS 的列高一致，虛擬捲動才不會在量測後跳動。預設 32。 */
  itemSize?: number;
  className?: string;
  'data-testid'?: string;
}

const DEFAULT_ITEM_SIZE = 32;

interface MenuRowProps {
  item: MenuItemDescriptor;
  index: number;
  id: string;
  start: number | undefined;
  isActive: boolean;
  measureElement: ((element: Element | null) => void) | undefined;
  className: string | undefined;
  style: CSSProperties | undefined;
  testId: string | undefined;
  onActivate: (index: number) => void;
  onHover: (index: number) => void;
}

/** 以 `memo` 包住：移動作用列時只有前後兩列重新 render。 */
const MenuRow = memo(function MenuRow({
  item,
  index,
  id,
  start,
  isActive,
  measureElement,
  className,
  style,
  testId,
  onActivate,
  onHover,
}: MenuRowProps) {
  const props = {
    id,
    ref: measureElement,
    role: 'menuitem',
    'aria-disabled': item.disabled || undefined,
    className,
    style: withRowPosition(style, start),
    'data-testid': testId,
    'data-index': index,
    'data-value': item.key,
    'data-tone': item.tone ?? 'default',
    'data-highlighted': isActive || undefined,
    'data-disabled': item.disabled || undefined,
    onClick: (event: ReactMouseEvent) => {
      if (item.disabled) {
        event.preventDefault();
        return;
      }
      onActivate(index);
    },
    // 用 pointermove 而不是 pointerenter：列表捲動經過靜止的游標時不會亂換作用列
    onPointerMove: () => {
      if (!isActive) onHover(index);
    },
  };
  if (item.render) return cloneElement(item.render, { ...props, children: item.label });
  return <div {...props}>{item.label}</div>;
});

/**
 * 動作選單。
 *
 * 以 Base UI Popover 負責定位、點外面／Esc 關閉與焦點歸還；列表自己以 `aria-activedescendant`
 * 管理作用列，才能虛擬捲動（Base UI Menu 需要所有項目都掛在 DOM 上）。
 * 項目多時自動虛擬捲動；傳 `onLoadMore` ＋ `hasMore` 即為無限捲動。
 */
export function Menu({
  trigger,
  items,
  align = 'end',
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  hasMore,
  loading,
  onLoadMore,
  loadingLabel = '載入中…',
  emptyLabel,
  virtualThreshold,
  itemSize = DEFAULT_ITEM_SIZE,
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: MenuProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  const [open, setOpen] = useControllableState(openProp, defaultOpen, onOpenChange);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const openedByKeyboard = useRef(true);
  const baseId = useId();

  const { rows, containerStyle, measureElement, scrollToIndex } = useVirtualRows({
    count: items.length,
    scrollElement,
    estimateSize: itemSize,
    threshold: virtualThreshold,
  });
  const { onScroll } = useInfiniteScroll({
    scrollElement,
    count: items.length,
    hasMore,
    loading,
    onLoadMore,
  });

  const itemsRef = useLatestRef(items);
  const navigation = useListNavigation({
    count: items.length,
    isDisabled: (index) => {
      const item = items[index];
      return !item || Boolean(item.disabled);
    },
    getLabel: (index) => {
      const item = items[index];
      return item?.textValue ?? (typeof item?.label === 'string' ? item.label : undefined);
    },
    onNavigate: scrollToIndex,
    loop: true,
  });
  const { activeIndex, setActiveIndex, navigateTo, firstEnabled } = navigation;

  // 開啟後（捲動容器掛上時）：鍵盤開啟的話作用列落在第一個可用項目（WAI-ARIA menu button 的慣例），
  // 滑鼠開啟則不預選
  useEffect(() => {
    if (!open || !scrollElement) return;
    if (openedByKeyboard.current) navigateTo(firstEnabled());
    else setActiveIndex(-1);
  }, [open, scrollElement, firstEnabled, navigateTo, setActiveIndex]);

  const optionId = (index: number) => `${baseId}-${index}`;

  const onActivate = useCallback(
    (index: number) => {
      itemsRef.current[index]?.onSelect?.();
      setOpen(false);
    },
    [itemsRef, setOpen],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (navigation.handleKeyDown(event)) return;
    if ((event.key === 'Enter' || event.key === ' ') && activeIndex >= 0) {
      event.preventDefault();
      // 交給列元素自己的 click：連結項目（render）才會照常導頁
      const element = document.getElementById(optionId(activeIndex));
      if (element) element.click();
      else onActivate(activeIndex);
    }
  };

  const itemSlot = slot('item', styles.item, { testId: 'menu-item' });
  const listSlot = slot('list', styles.list);
  const isEmpty = items.length === 0 && !loading;

  return (
    <BasePopover.Root open={open} onOpenChange={(next) => setOpen(next)}>
      <BasePopover.Trigger
        render={trigger}
        aria-haspopup="menu"
        onPointerDown={() => {
          openedByKeyboard.current = false;
        }}
        onKeyDown={(event: KeyboardEvent) => {
          openedByKeyboard.current = true;
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      />
      <BasePopover.Portal>
        <BasePopover.Positioner
          align={align}
          sideOffset={4}
          {...slot('positioner', styles.positioner)}
        >
          <BasePopover.Popup
            ref={setScrollElement}
            role="presentation"
            initialFocus={listRef}
            className={cn(styles.popup, className)}
            onScroll={onScroll}
            {...rest}
          >
            <div
              ref={listRef}
              role="menu"
              tabIndex={-1}
              aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
              onKeyDown={onKeyDown}
              className={listSlot.className}
              style={containerStyle ? { ...listSlot.style, ...containerStyle } : listSlot.style}
              data-testid={listSlot['data-testid']}
            >
              {rows.map(({ index, start }) => {
                const item = items[index];
                if (!item) return null;
                return (
                  <MenuRow
                    key={item.key}
                    item={item}
                    index={index}
                    id={optionId(index)}
                    start={start}
                    isActive={index === activeIndex}
                    measureElement={measureElement}
                    className={itemSlot.className}
                    style={itemSlot.style}
                    testId={itemSlot['data-testid']}
                    onActivate={onActivate}
                    onHover={setActiveIndex}
                  />
                );
              })}
            </div>
            {(loading || (isEmpty && emptyLabel)) && (
              <div {...slot('footer', styles.footer, { testId: 'menu-footer' })}>
                {loading ? <Spinner size={16} label={loadingLabel} /> : emptyLabel}
              </div>
            )}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
