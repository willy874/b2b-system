import { Popover as BasePopover } from '@base-ui-components/react/popover';
import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/shared/utils';

import './Popover.css';

export interface PopoverProps {
  trigger: ReactElement<Record<string, unknown>>;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  className?: string;
  'data-testid'?: string;
}

/** 非強制互動的浮層（Dialog 是強制的）。焦點管理與定位由 Base UI 處理。 */
export function Popover({
  trigger,
  title,
  description,
  children,
  open,
  defaultOpen,
  onOpenChange,
  side = 'bottom',
  align = 'start',
  className,
  ...rest
}: PopoverProps) {
  return (
    <BasePopover.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={(next: boolean) => onOpenChange?.(next)}
    >
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner
          side={side}
          align={align}
          sideOffset={6}
          className="ge-popover__positioner"
        >
          <BasePopover.Popup className={cn('ge-popover__popup', className)} {...rest}>
            {title && <BasePopover.Title className="ge-popover__title">{title}</BasePopover.Title>}
            {description && (
              <BasePopover.Description className="ge-popover__description">
                {description}
              </BasePopover.Description>
            )}
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}

export const PopoverClose = BasePopover.Close;
