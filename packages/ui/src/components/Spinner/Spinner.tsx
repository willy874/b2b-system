import { cn } from '@b2b-system/web-shared/utils';
import type { Ref } from 'react';

import { useComponentLabels } from '../labels';

import styles from './Spinner.module.css';

export interface SpinnerProps {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLOutputElement>;
  size?: number;
  className?: string;
  /** 報讀器念的名稱；沒有傳時用 `ComponentLabelsContext` 的「載入中」（目前語系）。 */
  label?: string;
  'data-testid'?: string;
}

export function Spinner({ size = 20, className, label, ...rest }: SpinnerProps) {
  const labels = useComponentLabels();
  return (
    <output
      className={cn(styles.root, className)}
      style={{ width: size, height: size }}
      aria-label={label ?? labels.loading}
      {...rest}
    />
  );
}
