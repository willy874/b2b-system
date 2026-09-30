import { AlertDialog as BaseAlertDialog } from '@base-ui-components/react/alert-dialog';
import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { Button } from '../Button';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './AlertDialog.module.css';

/** `className` 落在彈窗（popup）；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type AlertDialogSlot =
  | 'backdrop'
  | 'title'
  | 'description'
  | 'actions'
  | 'cancel'
  | 'confirm';

export interface AlertDialogProps extends SlotOverrides<AlertDialogSlot> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

/** 破壞性確認：刻意不可用遮罩關閉，避免「以為取消了但其實什麼都沒發生」。 */
export function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  loading,
  onConfirm,
  children,
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: AlertDialogProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  return (
    <BaseAlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseAlertDialog.Portal>
        <BaseAlertDialog.Backdrop {...slot('backdrop', styles.backdrop)} />
        <BaseAlertDialog.Popup className={cn(styles.popup, className)} {...rest}>
          <BaseAlertDialog.Title {...slot('title', styles.title)}>{title}</BaseAlertDialog.Title>
          {description && (
            <BaseAlertDialog.Description {...slot('description', styles.description)}>
              {description}
            </BaseAlertDialog.Description>
          )}
          {children}
          <div {...slot('actions', styles.actions)}>
            <BaseAlertDialog.Close
              render={<Button variant="secondary" disabled={loading} />}
              {...slot('cancel', undefined, { testId: 'alert-dialog-cancel' })}
            >
              {cancelLabel}
            </BaseAlertDialog.Close>
            <Button
              variant={tone === 'danger' ? 'danger' : 'primary'}
              loading={loading}
              onClick={() => void onConfirm()}
              {...slot('confirm', undefined, { testId: 'alert-dialog-confirm' })}
            >
              {confirmLabel}
            </Button>
          </div>
        </BaseAlertDialog.Popup>
      </BaseAlertDialog.Portal>
    </BaseAlertDialog.Root>
  );
}
