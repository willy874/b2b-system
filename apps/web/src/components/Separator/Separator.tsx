import { Separator as BaseSeparator } from '@base-ui-components/react/separator';
import type { Ref } from 'react';

import { cn } from '@/shared/utils';

import './Separator.css';

export interface SeparatorProps {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
  'data-testid'?: string;
}

export function Separator({ orientation = 'horizontal', className, ...rest }: SeparatorProps) {
  return (
    <BaseSeparator
      orientation={orientation}
      className={cn('ge-separator', `ge-separator--${orientation}`, className)}
      {...rest}
    />
  );
}
