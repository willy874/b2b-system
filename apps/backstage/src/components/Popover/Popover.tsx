import { Popover as BasePopover } from '@base-ui/react/popover';
import type { CSSProperties, ReactElement, ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './Popover.module.css';

/** `className` / `style` / `data-testid` 落在彈層（popup）；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type PopoverSlot = 'positioner' | 'title' | 'description';

export interface PopoverProps extends SlotOverrides<PopoverSlot> {
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
  style?: CSSProperties;
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
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: PopoverProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
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
          {...slot('positioner', styles.positioner)}
        >
          <BasePopover.Popup className={cn(styles.popup, className)} {...rest}>
            {title && (
              <BasePopover.Title {...slot('title', styles.title)}>{title}</BasePopover.Title>
            )}
            {description && (
              <BasePopover.Description {...slot('description', styles.description)}>
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
