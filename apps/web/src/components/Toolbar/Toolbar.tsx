import { Toolbar as BaseToolbar } from '@base-ui-components/react/toolbar';
import type { ReactElement, ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import './Toolbar.css';

export type ToolbarOrientation = 'horizontal' | 'vertical';

const ORIENTATION_CLASS = {
  horizontal: 'ge-toolbar--horizontal',
  vertical: 'ge-toolbar--vertical',
} as const satisfies Record<ToolbarOrientation, string>;

export interface ToolbarProps {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
  orientation?: ToolbarOrientation;
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

/**
 * 一列操作按鈕。Base UI 提供 roving tabindex：整條 toolbar 只佔一個 Tab 停留點，
 * 內部用方向鍵移動。
 */
export function Toolbar({
  children,
  orientation = 'horizontal',
  className,
  ...rest
}: ToolbarProps) {
  return (
    <BaseToolbar.Root
      orientation={orientation}
      className={cn('ge-toolbar', ORIENTATION_CLASS[orientation], className)}
      {...rest}
    >
      {children}
    </BaseToolbar.Root>
  );
}

export interface ToolbarButtonProps {
  children: ReactNode;
  /** 用我們自己的 `Button` 渲染，保留設計系統的外觀。 */
  render?: ReactElement<Record<string, unknown>>;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
}

export function ToolbarButton({ children, render, className, ...rest }: ToolbarButtonProps) {
  return (
    <BaseToolbar.Button render={render} className={cn('ge-toolbar__button', className)} {...rest}>
      {children}
    </BaseToolbar.Button>
  );
}

export function ToolbarSeparator({ className }: { className?: string }) {
  return <BaseToolbar.Separator className={cn('ge-toolbar__separator', className)} />;
}

export function ToolbarGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <BaseToolbar.Group className={cn('ge-toolbar__group', className)}>{children}</BaseToolbar.Group>
  );
}
