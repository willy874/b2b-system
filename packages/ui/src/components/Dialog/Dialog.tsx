import { cn } from '@b2b-system/web-shared/utils';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import type { DialogRootChangeEventDetails } from '@base-ui/react/dialog';
import type { ReactNode } from 'react';

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
  /**
   * 點擊遮罩或按 Esc 是否關閉。破壞性操作、只顯示一次的內容（密鑰、token）應設為 false：
   * 只剩對話框裡的按鈕能關閉。
   */
  dismissible?: boolean;
  children: ReactNode;
  className?: string;
  'data-testid'?: string;
}

/** `dismissible={false}` 時擋下的關閉原因：Esc、點遮罩。對話框內的按鈕（`close-press`）不受影響。 */
const DISMISS_REASONS: ReadonlySet<string> = new Set([
  'escape-key',
  'outside-press',
  'close-watcher',
]);

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
  const changeOpen = (next: boolean, details: DialogRootChangeEventDetails) => {
    // 不可關閉時，Esc（含 Android 的返回手勢）與點遮罩都不往外傳；非受控時也要取消 Base UI 自己的關閉
    if (!next && !dismissible && DISMISS_REASONS.has(details.reason)) {
      details.cancel();
      return;
    }
    onOpenChange?.(next);
  };
  return (
    <BaseDialog.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={changeOpen}
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
