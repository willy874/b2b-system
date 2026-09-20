import type { Ref } from 'react';

import { cn } from '@/shared/utils';

import './Skeleton.css';

export interface SkeletonProps {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLSpanElement>;
  width?: number | string;
  height?: number | string;
  rounded?: boolean;
  className?: string;
  'data-testid'?: string;
}

export function Skeleton({ width, height = 16, rounded, className, ...rest }: SkeletonProps) {
  return (
    <span
      className={cn('ge-skeleton', rounded && 'ge-skeleton--rounded', className)}
      style={{ width: width ?? '100%', height }}
      aria-hidden="true"
      {...rest}
    />
  );
}
