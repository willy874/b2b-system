import { ScrollArea as BaseScrollArea } from '@base-ui-components/react/scroll-area';
import type { CSSProperties, ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import './ScrollArea.css';

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
  styles,
  testIds,
  ...rest
}: ScrollAreaProps) {
  const slot = createSlots({ classNames, styles, testIds });
  return (
    <BaseScrollArea.Root className={cn('ge-scroll-area', className)} style={style} {...rest}>
      <BaseScrollArea.Viewport
        {...slot('viewport', 'ge-scroll-area__viewport', { style: { maxHeight } })}
      >
        <BaseScrollArea.Content {...slot('content')}>{children}</BaseScrollArea.Content>
      </BaseScrollArea.Viewport>

      {orientation !== 'horizontal' && (
        <BaseScrollArea.Scrollbar
          orientation="vertical"
          {...slot('scrollbar', 'ge-scroll-area__scrollbar')}
        >
          <BaseScrollArea.Thumb {...slot('thumb', 'ge-scroll-area__thumb')} />
        </BaseScrollArea.Scrollbar>
      )}
      {orientation !== 'vertical' && (
        <BaseScrollArea.Scrollbar
          orientation="horizontal"
          {...slot('scrollbar', [
            'ge-scroll-area__scrollbar',
            'ge-scroll-area__scrollbar--horizontal',
          ])}
        >
          <BaseScrollArea.Thumb {...slot('thumb', 'ge-scroll-area__thumb')} />
        </BaseScrollArea.Scrollbar>
      )}
      {orientation === 'both' && (
        <BaseScrollArea.Corner {...slot('corner', 'ge-scroll-area__corner')} />
      )}
    </BaseScrollArea.Root>
  );
}
