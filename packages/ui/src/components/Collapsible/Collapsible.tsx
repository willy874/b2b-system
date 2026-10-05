import { cn } from '@b2b-system/web-shared/utils';
import { Collapsible as BaseCollapsible } from '@base-ui/react/collapsible';
import type { ReactNode } from 'react';

import { Icon } from '../Icon';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './Collapsible.module.css';

/** `className` 落在根元素；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type CollapsibleSlot = 'trigger' | 'chevron' | 'title' | 'panel' | 'content';

export interface CollapsibleProps extends SlotOverrides<CollapsibleSlot> {
  title: ReactNode;
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}

export function Collapsible({
  title,
  children,
  open,
  defaultOpen,
  onOpenChange,
  disabled,
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: CollapsibleProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  return (
    <BaseCollapsible.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={(next: boolean) => onOpenChange?.(next)}
      disabled={disabled}
      className={cn(styles.root, className)}
      {...rest}
    >
      <BaseCollapsible.Trigger {...slot('trigger', styles.trigger)}>
        <Icon name="chevron-right" size={16} {...slot('chevron', styles.chevron)} />
        <span {...slot('title')}>{title}</span>
      </BaseCollapsible.Trigger>
      <BaseCollapsible.Panel {...slot('panel', styles.panel)}>
        <div {...slot('content', styles.content)}>{children}</div>
      </BaseCollapsible.Panel>
    </BaseCollapsible.Root>
  );
}
