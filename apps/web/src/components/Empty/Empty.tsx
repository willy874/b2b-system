import type { CSSProperties, ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import './Empty.css';

/** `className` 落在根元素；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type EmptySlot = 'title' | 'description' | 'action';

export interface EmptyProps extends SlotOverrides<EmptySlot> {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  style?: CSSProperties;
  'data-testid'?: string;
}

export function Empty({
  title,
  description,
  action,
  className,
  classNames,
  styles,
  testIds,
  ...rest
}: EmptyProps) {
  const slot = createSlots({ classNames, styles, testIds });
  return (
    <div className={cn('ge-empty', className)} {...rest}>
      <p {...slot('title', 'ge-empty__title')}>{title}</p>
      {description && <p {...slot('description', 'ge-empty__description')}>{description}</p>}
      {action && <div {...slot('action', 'ge-empty__action')}>{action}</div>}
    </div>
  );
}
