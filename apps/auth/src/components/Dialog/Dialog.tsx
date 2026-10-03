import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './Dialog.module.css';

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl';

/** `className` 落在彈窗（popup）；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type DialogSlot = 'backdrop' | 'header' | 'title' | 'description' | 'body' | 'footer';

export interface DialogProps extends SlotOverrides<DialogSlot> {
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
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: DialogProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  return (
    <BaseDialog.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      disablePointerDismissal={!dismissible}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop {...slot('backdrop', styles.backdrop)} />
        <BaseDialog.Popup className={cn(styles.popup, className)} data-size={size} {...rest}>
          <header {...slot('header', styles.header)}>
            <BaseDialog.Title {...slot('title', styles.title)}>{title}</BaseDialog.Title>
            {description && (
              <BaseDialog.Description {...slot('description', styles.description)}>
                {description}
              </BaseDialog.Description>
            )}
          </header>
          <div {...slot('body', styles.body)}>{children}</div>
          {footer && <footer {...slot('footer', styles.footer)}>{footer}</footer>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

/** 需要完全自訂版面時使用複合形式。 */
export const DialogPrimitive = BaseDialog;
