import { Separator as BaseSeparator } from '@base-ui-components/react/separator';
import type { Ref } from 'react';

import { cn } from '@/shared/utils';

import './Separator.css';

export type SeparatorOrientation = 'horizontal' | 'vertical';

const ORIENTATION_CLASS = {
  horizontal: 'ge-separator--horizontal',
  vertical: 'ge-separator--vertical',
} as const satisfies Record<SeparatorOrientation, string>;

export interface SeparatorProps {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  orientation?: SeparatorOrientation;
  className?: string;
  'data-testid'?: string;
}

export function Separator({ orientation = 'horizontal', className, ...rest }: SeparatorProps) {
  return (
    <BaseSeparator
      orientation={orientation}
      className={cn('ge-separator', ORIENTATION_CLASS[orientation], className)}
      {...rest}
    />
  );
}
