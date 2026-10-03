import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import type { ReactElement, ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import { fitIndices, useFitItems } from '../Ellipsis/useFitItems';
import { Icon } from '../Icon';
import { Menu } from '../Menu';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './Tabs.module.css';

export interface TabDescriptor {
  value: string;
  label: ReactNode;
  /**
   * 分頁的純文字：收進「更多」下拉時給鍵盤 typeahead 比對，改變時也會重新量寬度（例如切換語系）。
   * `label` 是字串時可省略。
   */
  textValue?: string;
  /** 用連結渲染分頁（讓分頁狀態留在網址上）。 */
  render?: ReactElement<Record<string, unknown>>;
}

/**
 * `className` / `data-testid` 落在根元素；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。
 * `bar`：分頁列與「更多」下拉的外框（底線在這一層）；`more`：「更多」按鈕；`menuItem`：下拉裡的每個選項。
 */
export type TabsSlot = 'bar' | 'list' | 'tab' | 'indicator' | 'more' | 'menuItem';

export interface TabsProps extends SlotOverrides<TabsSlot> {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  value: string;
  onValueChange?: (value: string) => void;
  tabs: TabDescriptor[];
  /** 依寬度把放不下的分頁收進「更多」下拉；選取中的分頁一定留在外面。預設 `true`。 */
  fit?: boolean;
  /** 「更多」按鈕的文字。預設「更多」；`features/` 使用時以 `t()` 傳入。 */
  moreLabel?: string;
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

function textOf(tab: TabDescriptor): string | undefined {
  return tab.textValue ?? (typeof tab.label === 'string' ? tab.label : undefined);
}

/**
 * 分頁列。放不下時從尾端把分頁收進「更多」下拉（`useFitItems`），容器縮放時跟著重算；
 * 選取中的分頁被收起時改佔最後一個可見位置，讓使用者永遠看得到目前在哪一頁。
 */
export function Tabs({
  value,
  onValueChange,
  tabs,
  fit = true,
  moreLabel = '更多',
  children,
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: TabsProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  const selectedIndex = tabs.findIndex((tab) => tab.value === value);
  // 文字改變（切換語系）時寬度跟著變，也要重新量
  const signature = tabs.map((tab) => `${tab.value}:${textOf(tab) ?? ''}`).join('|');
  const { attachRoot, attachItem, attachOverflow, isMeasuring, visible } = useFitItems({
    signature,
    count: tabs.length,
    enabled: fit,
    pick: ({ widths, overflowWidth, gap, available }) =>
      !fit || available <= 0
        ? tabs.map((_, index) => index)
        : fitIndices(widths, overflowWidth, gap, available, {
            pinned: selectedIndex >= 0 ? selectedIndex : undefined,
          }),
  });
  const visibleSet = new Set(visible);
  const hiddenTabs = isMeasuring ? tabs : tabs.filter((_, index) => !visibleSet.has(index));

  return (
    <BaseTabs.Root
      value={value}
      onValueChange={(next) => onValueChange?.(String(next))}
      className={cn(styles.root, className)}
      data-overflowing={(!isMeasuring && hiddenTabs.length > 0) || undefined}
      {...rest}
    >
      <div ref={attachRoot} {...slot('bar', styles.bar)}>
        <BaseTabs.List {...slot('list', styles.list)}>
          {visible.map((index) => {
            const tab = tabs[index];
            if (!tab) return null;
            return (
              <BaseTabs.Tab
                key={tab.value}
                ref={attachItem(index)}
                value={tab.value}
                render={tab.render}
                {...slot('tab', styles.tab, { testId: 'tab' })}
                data-value={tab.value}
              >
                {tab.label}
              </BaseTabs.Tab>
            );
          })}
          <BaseTabs.Indicator {...slot('indicator', styles.indicator)} />
        </BaseTabs.List>
        {hiddenTabs.length > 0 && (
          <div ref={attachOverflow} className={styles.overflow}>
            <Menu
              align="end"
              trigger={
                <button type="button" {...slot('more', styles.more, { testId: 'tabs-more' })}>
                  {moreLabel}
                  <Icon name="chevron-down" size={14} />
                </button>
              }
              items={hiddenTabs.map((tab) => ({
                key: tab.value,
                label: tab.label,
                textValue: textOf(tab),
                render: tab.render,
                onSelect: () => onValueChange?.(tab.value),
              }))}
              classNames={{ item: classNames?.menuItem }}
              styles={{ item: styleOverrides?.menuItem }}
              testIds={{ item: testIds?.menuItem }}
            />
          </div>
        )}
      </div>
      {children}
    </BaseTabs.Root>
  );
}

export const TabsPanel = BaseTabs.Panel;
