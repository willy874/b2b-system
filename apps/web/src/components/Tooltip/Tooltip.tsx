import { Tooltip as BaseTooltip } from '@base-ui-components/react/tooltip';
import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './Tooltip.module.css';

/** `className` / `data-testid` 落在提示框（popup）；定位層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type TooltipSlot = 'positioner';

export interface TooltipProps extends SlotOverrides<TooltipSlot> {
  content: ReactNode;
  children: ReactElement<Record<string, unknown>>;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /**
   * 暫時不顯示提示，但保留觸發元素的結構。
   * 與「`content` 給空值」不同：切換時 children 不會被重新掛載（ref、量測狀態不會遺失）。
   */
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}

export function Tooltip({
  content,
  children,
  side = 'top',
  disabled,
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: TooltipProps) {
  if (!content) return children;
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  return (
    <BaseTooltip.Root disabled={disabled}>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner
          side={side}
          sideOffset={6}
          {...slot('positioner', styles.positioner)}
        >
          <BaseTooltip.Popup className={cn(styles.popup, className)} {...rest}>
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

export const TooltipProvider = BaseTooltip.Provider;
