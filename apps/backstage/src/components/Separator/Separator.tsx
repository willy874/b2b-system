import { Separator as BaseSeparator } from '@base-ui/react/separator';
import type { Ref } from 'react';

import { cn } from '@/shared/utils';

import styles from './Separator.module.css';

export type SeparatorOrientation = 'horizontal' | 'vertical';

export interface SeparatorProps {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  orientation?: SeparatorOrientation;
  className?: string;
  'data-testid'?: string;
}

export function Separator({ orientation = 'horizontal', className, ...rest }: SeparatorProps) {
  return (
    <BaseSeparator orientation={orientation} className={cn(styles.root, className)} {...rest} />
  );
}
