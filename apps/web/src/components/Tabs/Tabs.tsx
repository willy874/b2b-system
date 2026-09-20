import { Tabs as BaseTabs } from '@base-ui-components/react/tabs';
import type { ReactElement, ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import './Tabs.css';

export interface TabDescriptor {
  value: string;
  label: ReactNode;
  /** 用連結渲染分頁（讓分頁狀態留在網址上）。 */
  render?: ReactElement<Record<string, unknown>>;
}

export interface TabsProps {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  value: string;
  onValueChange?: (value: string) => void;
  tabs: TabDescriptor[];
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

export function Tabs({ value, onValueChange, tabs, children, className, ...rest }: TabsProps) {
  return (
    <BaseTabs.Root
      value={value}
      onValueChange={(next) => onValueChange?.(String(next))}
      className={cn('ge-tabs', className)}
      {...rest}
    >
      <BaseTabs.List className="ge-tabs__list">
        {tabs.map((tab) => (
          <BaseTabs.Tab
            key={tab.value}
            value={tab.value}
            render={tab.render}
            className="ge-tabs__tab"
            data-testid={`tab-${tab.value}`}
          >
            {tab.label}
          </BaseTabs.Tab>
        ))}
        <BaseTabs.Indicator className="ge-tabs__indicator" />
      </BaseTabs.List>
      {children}
    </BaseTabs.Root>
  );
}

export const TabsPanel = BaseTabs.Panel;
