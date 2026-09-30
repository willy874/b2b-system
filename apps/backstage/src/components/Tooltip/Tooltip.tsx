import { Tooltip as BaseTooltip } from '@base-ui-components/react/tooltip';
import { cloneElement } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { Button, IconButton } from '../Button';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './Tooltip.module.css';

/** `className` / `data-testid` 落在提示框（popup）；定位層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type TooltipSlot = 'positioner';

export interface TooltipProps extends SlotOverrides<TooltipSlot> {
  content: ReactNode;
  /**
   * 觸發元素。停用的 `Button` / `IconButton` 會自動以 `focusableWhenDisabled` 渲染（`aria-disabled`、仍可聚焦），
   * 提示才出得來；其他元素若用原生 `disabled`，瀏覽器不會送 hover，提示不會顯示。
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
  // 原生 disabled 的按鈕收不到 hover／focus，提示永遠出不來——偏偏這時最需要說明「為什麼不能按」
  // （docs/architecture/frontend/06-permission.md §6.1）。設計系統的按鈕改用 aria-disabled 停用。
  const trigger =
    children.props.disabled && isDesignSystemButton(children)
      ? cloneElement(children, { focusableWhenDisabled: true })
      : children;
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

function isDesignSystemButton(element: ReactElement): boolean {
  return element.type === Button || element.type === IconButton;
}

export const TooltipProvider = BaseTooltip.Provider;
