import { cn } from '@b2b-system/web-shared/utils';
import type { HTMLAttributes, ReactNode, Ref } from 'react';

import { Tooltip } from '../Tooltip';
import type { TooltipProps } from '../Tooltip';
import { shouldShowTooltip, useComposedRef, useEllipsis } from './useEllipsis';
import type { EllipsisCollapseAt, EllipsisTooltip } from './useEllipsis';

import styles from './Ellipsis.module.css';

export interface TextEllipsisProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLSpanElement>;
  children: ReactNode;
  /** 最多顯示幾行，超過以省略號結尾。預設 1。 */
  lines?: number;
  /** 以 inline-block 排版（夾在文字行內時用）；預設為 block，寬度跟著父層。 */
  inline?: boolean;
  /** 何時顯示提示；預設 `auto`（被截斷或已收合才顯示）。 */
  tooltip?: EllipsisTooltip;
  /** 提示內容；預設為 `children`。 */
  tooltipContent?: ReactNode;
  tooltipSide?: TooltipProps['side'];
  /** 收合判斷點；未設定時只截斷、不收合。見 `EllipsisCollapseAt`。 */
  collapseAt?: EllipsisCollapseAt;
  /** 收合後取代內容的節點（例如圖示或縮寫）；原內容仍保留給螢幕報讀器。 */
  collapsedContent?: ReactNode;
  onCollapseChange?: (collapsed: boolean) => void;
}

/**
 * 放不下時以省略號截斷的文字；被截斷時 hover 顯示完整內容，
 * 可再設定判斷點，在空間不足時整個換成替代節點。
 */
export function TextEllipsis({
  ref,
  children,
  lines = 1,
  inline,
  tooltip = 'auto',
  tooltipContent,
  tooltipSide,
  collapseAt,
  collapsedContent,
  onCollapseChange,
  className,
  style,
  ...rest
}: TextEllipsisProps) {
  const { attachText, isTruncated, isCollapsed } = useEllipsis({
    lines,
    collapseAt,
    onCollapseChange,
  });
  const composedRef = useComposedRef<HTMLSpanElement>(ref, attachText);
  const isMultiline = lines > 1;

  return (
    <Tooltip
      content={tooltipContent ?? children}
      side={tooltipSide}
      disabled={!shouldShowTooltip(tooltip, { isTruncated, isCollapsed })}
    >
      <span
        ref={composedRef}
        className={cn(styles.text, className)}
        style={isMultiline ? { WebkitLineClamp: lines, ...style } : style}
        data-inline={inline || undefined}
        data-multiline={isMultiline || undefined}
        data-collapsed={isCollapsed || undefined}
        data-truncated={isTruncated || undefined}
        {...rest}
      >
        {isCollapsed ? (
          <>
            <span aria-hidden>{collapsedContent}</span>
            <span className={styles.srOnly}>{children}</span>
          </>
        ) : (
          children
        )}
      </span>
    </Tooltip>
  );
}
