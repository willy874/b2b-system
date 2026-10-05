import { cn } from '@b2b-system/web-shared/utils';
import type { Ref } from 'react';

import styles from './Skeleton.module.css';

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
      className={cn(styles.root, className)}
      data-rounded={rounded || undefined}
      style={{ width: width ?? '100%', height }}
      aria-hidden="true"
      {...rest}
    />
  );
}
