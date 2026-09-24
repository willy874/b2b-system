import { Collapsible as BaseCollapsible } from '@base-ui-components/react/collapsible';
import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { Icon } from '../Icon';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import './Collapsible.css';

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
  styles,
  testIds,
  ...rest
}: CollapsibleProps) {
  const slot = createSlots({ classNames, styles, testIds });
  return (
    <BaseCollapsible.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={(next: boolean) => onOpenChange?.(next)}
      disabled={disabled}
      className={cn('ge-collapsible', className)}
      {...rest}
    >
      <BaseCollapsible.Trigger {...slot('trigger', 'ge-collapsible__trigger')}>
        <Icon name="chevron-right" size={16} {...slot('chevron', 'ge-collapsible__chevron')} />
        <span {...slot('title')}>{title}</span>
      </BaseCollapsible.Trigger>
      <BaseCollapsible.Panel {...slot('panel', 'ge-collapsible__panel')}>
        <div {...slot('content', 'ge-collapsible__content')}>{children}</div>
      </BaseCollapsible.Panel>
    </BaseCollapsible.Root>
  );
}
