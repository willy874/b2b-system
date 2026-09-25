import { Tooltip as BaseTooltip } from '@base-ui-components/react/tooltip';
import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './Tooltip.module.css';

/** `className` / `data-testid` 落在提示框（popup）；定位層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type TooltipSlot = 'positioner';

export interface TooltipProps extends SlotOverrides<TooltipSlot> {
  content: ReactNode;
  /**
   * 觸發元素。帶 `disabled` 時自動外包一層可聚焦的 `<span>` 當觸發點（停用的按鈕收不到 hover／focus），
   * 停用與否切換時觸發元素會重新掛載。
   */
  children: ReactElement<Record<string, unknown>>;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /**
   * 暫時不顯示提示，但保留觸發元素的結構。
   * 與「`content` 給空值」不同：切換時 children 不會被重新掛載（ref、量測狀態不會遺失）。
   */
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}

export function Tooltip({
  content,
  children,
  side = 'top',
  disabled,
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: TooltipProps) {
  if (!content) return children;
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  // 停用的按鈕收不到滑鼠事件、也無法聚焦，提示永遠出不來——偏偏這時最需要說明「為什麼不能按」
  // （docs/architecture/frontend/06-permission.md §6.1）。改由外層可聚焦的 span 當觸發點。
  const trigger = children.props.disabled ? (
    // 刻意可聚焦：停用的按鈕無法聚焦，鍵盤使用者只能靠這層看到「為什麼不能按」
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <span className={styles.disabledTrigger} tabIndex={0} data-testid="tooltip-disabled-trigger">
      {children}
    </span>
  ) : (
    children
  );
  return (
    <BaseTooltip.Root disabled={disabled}>
      <BaseTooltip.Trigger render={trigger} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner
          side={side}
          sideOffset={6}
          {...slot('positioner', styles.positioner)}
        >
          <BaseTooltip.Popup className={cn(styles.popup, className)} {...rest}>
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

export const TooltipProvider = BaseTooltip.Provider;
