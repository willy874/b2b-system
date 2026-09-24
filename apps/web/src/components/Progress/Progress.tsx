import { Progress as BaseProgress } from '@base-ui-components/react/progress';
import type { ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import './Progress.css';

export type ProgressTone = 'brand' | 'success' | 'danger';

const TONE_CLASS = {
  brand: 'ge-progress--brand',
  success: 'ge-progress--success',
  danger: 'ge-progress--danger',
} as const satisfies Record<ProgressTone, string>;

export interface ProgressProps {
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
  ...rest
}: ProgressProps) {
  return (
    <BaseProgress.Root
      value={value}
      max={max}
      className={cn('ge-progress', TONE_CLASS[tone], className)}
      {...rest}
    >
      {(label || showValue) && (
        <div className="ge-progress__header">
          {label && <BaseProgress.Label className="ge-progress__label">{label}</BaseProgress.Label>}
          {showValue && <BaseProgress.Value className="ge-progress__value" />}
        </div>
      )}
      <BaseProgress.Track className="ge-progress__track">
        <BaseProgress.Indicator className="ge-progress__indicator" />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}
