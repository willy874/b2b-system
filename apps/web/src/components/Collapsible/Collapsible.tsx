import { Collapsible as BaseCollapsible } from '@base-ui-components/react/collapsible';
import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { Icon } from '../Icon';

import './Collapsible.css';

export interface CollapsibleProps {
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
  ...rest
}: CollapsibleProps) {
  return (
    <BaseCollapsible.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={(next: boolean) => onOpenChange?.(next)}
      disabled={disabled}
      className={cn('ge-collapsible', className)}
      {...rest}
    >
      <BaseCollapsible.Trigger className="ge-collapsible__trigger">
        <Icon name="chevron-right" size={16} className="ge-collapsible__chevron" />
        <span>{title}</span>
      </BaseCollapsible.Trigger>
      <BaseCollapsible.Panel className="ge-collapsible__panel">
        <div className="ge-collapsible__content">{children}</div>
      </BaseCollapsible.Panel>
    </BaseCollapsible.Root>
  );
}
