import type { Ref } from 'react';

import { cn } from '@/shared/utils';

import './Spinner.css';

export interface SpinnerProps {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLOutputElement>;
  size?: number;
  className?: string;
  label?: string;
  'data-testid'?: string;
}

export function Spinner({ size = 20, className, label, ...rest }: SpinnerProps) {
  return (
    <output
      className={cn('ge-spinner', className)}
      style={{ width: size, height: size }}
      aria-label={label ?? 'loading'}
      {...rest}
    />
  );
}
