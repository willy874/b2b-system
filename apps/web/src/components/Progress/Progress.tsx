import { Progress as BaseProgress } from '@base-ui-components/react/progress';
import type { ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './Progress.module.css';

export type ProgressTone = 'brand' | 'success' | 'danger';

/** `className` 落在根元素；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type ProgressSlot = 'header' | 'label' | 'value' | 'track' | 'indicator';

export interface ProgressProps extends SlotOverrides<ProgressSlot> {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  /** `null` 代表不確定進度（indeterminate）。 */
  value: number | null;
  max?: number;
  label?: ReactNode;
  /** 在右側顯示百分比。 */
  showValue?: boolean;
  tone?: ProgressTone;
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

export function Progress({
  value,
  max = 100,
  label,
  showValue,
  tone = 'brand',
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: ProgressProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  return (
    <BaseProgress.Root
      value={value}
      max={max}
      className={cn(styles.root, className)}
      data-tone={tone}
      {...rest}
    >
      {(label || showValue) && (
        <div {...slot('header', styles.header)}>
          {label && (
            <BaseProgress.Label {...slot('label', styles.label)}>{label}</BaseProgress.Label>
          )}
          {showValue && <BaseProgress.Value {...slot('value', styles.value)} />}
        </div>
      )}
      <BaseProgress.Track {...slot('track', styles.track)}>
        <BaseProgress.Indicator {...slot('indicator', styles.indicator)} />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}
