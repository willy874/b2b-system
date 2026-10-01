import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area';
import type { CSSProperties, ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './ScrollArea.module.css';

/** `className` 落在根元素；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type ScrollAreaSlot = 'viewport' | 'content' | 'scrollbar' | 'thumb' | 'corner';

export interface ScrollAreaProps extends SlotOverrides<ScrollAreaSlot> {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
  /** 最大高度；超過才會出現捲軸。 */
  maxHeight?: number | string;
  orientation?: 'vertical' | 'horizontal' | 'both';
  className?: string;
  style?: CSSProperties;
  'data-testid'?: string;
}

/** 自訂外觀的捲動容器；捲動行為與鍵盤操作仍是原生的。 */
export function ScrollArea({
  children,
  maxHeight = 320,
  orientation = 'vertical',
  className,
  style,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: ScrollAreaProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  return (
    <BaseScrollArea.Root className={cn(styles.root, className)} style={style} {...rest}>
      <BaseScrollArea.Viewport {...slot('viewport', styles.viewport, { style: { maxHeight } })}>
        <BaseScrollArea.Content {...slot('content')}>{children}</BaseScrollArea.Content>
      </BaseScrollArea.Viewport>

      {orientation !== 'horizontal' && (
        <BaseScrollArea.Scrollbar orientation="vertical" {...slot('scrollbar', styles.scrollbar)}>
          <BaseScrollArea.Thumb {...slot('thumb', styles.thumb)} />
        </BaseScrollArea.Scrollbar>
      )}
      {orientation !== 'vertical' && (
        <BaseScrollArea.Scrollbar orientation="horizontal" {...slot('scrollbar', styles.scrollbar)}>
          <BaseScrollArea.Thumb {...slot('thumb', styles.thumb)} />
        </BaseScrollArea.Scrollbar>
      )}
      {orientation === 'both' && <BaseScrollArea.Corner {...slot('corner', styles.corner)} />}
    </BaseScrollArea.Root>
  );
}
