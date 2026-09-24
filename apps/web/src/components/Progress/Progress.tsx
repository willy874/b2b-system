import { Progress as BaseProgress } from '@base-ui-components/react/progress';
import type { ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import './Progress.css';

export type ProgressTone = 'brand' | 'success' | 'danger';

const TONE_CLASS = {
  brand: 'ge-progress--brand',
  success: 'ge-progress--success',
  danger: 'ge-progress--danger',
} as const satisfies Record<ProgressTone, string>;

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
  styles,
  testIds,
  ...rest
}: ProgressProps) {
  const slot = createSlots({ classNames, styles, testIds });
  return (
    <BaseProgress.Root
      value={value}
      max={max}
      className={cn('ge-progress', TONE_CLASS[tone], className)}
      {...rest}
    >
      {(label || showValue) && (
        <div {...slot('header', 'ge-progress__header')}>
          {label && (
            <BaseProgress.Label {...slot('label', 'ge-progress__label')}>
              {label}
            </BaseProgress.Label>
          )}
          {showValue && <BaseProgress.Value {...slot('value', 'ge-progress__value')} />}
        </div>
      )}
      <BaseProgress.Track {...slot('track', 'ge-progress__track')}>
        <BaseProgress.Indicator {...slot('indicator', 'ge-progress__indicator')} />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}
