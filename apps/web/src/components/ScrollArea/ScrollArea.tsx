import { ScrollArea as BaseScrollArea } from '@base-ui-components/react/scroll-area';
import type { CSSProperties, ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import './ScrollArea.css';

export interface ScrollAreaProps {
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
  ...rest
}: ScrollAreaProps) {
  return (
    <BaseScrollArea.Root className={cn('ge-scroll-area', className)} style={style} {...rest}>
      <BaseScrollArea.Viewport className="ge-scroll-area__viewport" style={{ maxHeight }}>
        <BaseScrollArea.Content>{children}</BaseScrollArea.Content>
      </BaseScrollArea.Viewport>

      {orientation !== 'horizontal' && (
        <BaseScrollArea.Scrollbar orientation="vertical" className="ge-scroll-area__scrollbar">
          <BaseScrollArea.Thumb className="ge-scroll-area__thumb" />
        </BaseScrollArea.Scrollbar>
      )}
      {orientation !== 'vertical' && (
        <BaseScrollArea.Scrollbar
          orientation="horizontal"
          className="ge-scroll-area__scrollbar ge-scroll-area__scrollbar--horizontal"
        >
          <BaseScrollArea.Thumb className="ge-scroll-area__thumb" />
        </BaseScrollArea.Scrollbar>
      )}
      {orientation === 'both' && <BaseScrollArea.Corner className="ge-scroll-area__corner" />}
    </BaseScrollArea.Root>
  );
}
