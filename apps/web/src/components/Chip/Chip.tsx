import type { ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import './Chip.css';

export type ChipTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

export interface ChipProps {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLSpanElement>;
  tone?: ChipTone;
  children: ReactNode;
  className?: string;
  'data-testid'?: string;
}

export function Chip({ tone = 'neutral', children, className, ...rest }: ChipProps) {
  return (
    <span className={cn('ge-chip', `ge-chip--${tone}`, className)} {...rest}>
      {children}
    </span>
  );
}
