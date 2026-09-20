import { Tooltip as BaseTooltip } from '@base-ui-components/react/tooltip';
import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/shared/utils';

import './Tooltip.css';

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement<Record<string, unknown>>;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  'data-testid'?: string;
}

export function Tooltip({ content, children, side = 'top', className, ...rest }: TooltipProps) {
  if (!content) return children;
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={6} className="ge-tooltip__positioner">
          <BaseTooltip.Popup className={cn('ge-tooltip__popup', className)} {...rest}>
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

export const TooltipProvider = BaseTooltip.Provider;
