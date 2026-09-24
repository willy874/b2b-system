import { Tabs as BaseTabs } from '@base-ui-components/react/tabs';
import type { ReactElement, ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import './Tabs.css';

export interface TabDescriptor {
  value: string;
  label: ReactNode;
  /** 用連結渲染分頁（讓分頁狀態留在網址上）。 */
  render?: ReactElement<Record<string, unknown>>;
}

/** `className` 落在根元素；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type TabsSlot = 'list' | 'tab' | 'indicator';

export interface TabsProps extends SlotOverrides<TabsSlot> {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  value: string;
  onValueChange?: (value: string) => void;
  tabs: TabDescriptor[];
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

export function Tabs({
  value,
  onValueChange,
  tabs,
  children,
  className,
  classNames,
  styles,
  testIds,
  ...rest
}: TabsProps) {
  const slot = createSlots({ classNames, styles, testIds });
  return (
    <BaseTabs.Root
      value={value}
      onValueChange={(next) => onValueChange?.(String(next))}
      className={cn('ge-tabs', className)}
      {...rest}
    >
      <BaseTabs.List {...slot('list', 'ge-tabs__list')}>
        {tabs.map((tab) => (
          <BaseTabs.Tab
            key={tab.value}
            value={tab.value}
            render={tab.render}
            {...slot('tab', 'ge-tabs__tab', { testId: 'tab' })}
            data-value={tab.value}
          >
            {tab.label}
          </BaseTabs.Tab>
        ))}
        <BaseTabs.Indicator {...slot('indicator', 'ge-tabs__indicator')} />
      </BaseTabs.List>
      {children}
    </BaseTabs.Root>
  );
}

export const TabsPanel = BaseTabs.Panel;
