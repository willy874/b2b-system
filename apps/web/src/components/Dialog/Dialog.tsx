import { Dialog as BaseDialog } from '@base-ui-components/react/dialog';
import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

import './Dialog.css';

export type DialogSize = 'sm' | 'md' | 'lg';

const SIZE_CLASS = {
  sm: 'ge-dialog__popup--sm',
  md: 'ge-dialog__popup--md',
  lg: 'ge-dialog__popup--lg',
} as const satisfies Record<DialogSize, string>;

export interface DialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  size?: DialogSize;
  /** 點擊遮罩是否關閉。破壞性操作應設為 false。 */
  dismissible?: boolean;
  children: ReactNode;
  className?: string;
  'data-testid'?: string;
}

export function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  title,
  description,
  footer,
  size = 'md',
  dismissible = true,
  children,
  className,
  ...rest
}: DialogProps) {
  return (
    <BaseDialog.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      disablePointerDismissal={!dismissible}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="ge-dialog__backdrop" />
        <BaseDialog.Popup className={cn('ge-dialog__popup', SIZE_CLASS[size], className)} {...rest}>
          <header className="ge-dialog__header">
            <BaseDialog.Title className="ge-dialog__title">{title}</BaseDialog.Title>
            {description && (
              <BaseDialog.Description className="ge-dialog__description">
                {description}
              </BaseDialog.Description>
            )}
          </header>
          <div className="ge-dialog__body">{children}</div>
          {footer && <footer className="ge-dialog__footer">{footer}</footer>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

/** 需要完全自訂版面時使用複合形式。 */
export const DialogPrimitive = BaseDialog;
