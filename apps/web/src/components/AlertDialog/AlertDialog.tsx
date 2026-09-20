import { AlertDialog as BaseAlertDialog } from '@base-ui-components/react/alert-dialog';
import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { Button } from '../Button';

import './AlertDialog.css';

export interface AlertDialogProps {
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
  ...rest
}: AlertDialogProps) {
  return (
    <BaseAlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseAlertDialog.Portal>
        <BaseAlertDialog.Backdrop className="ge-alert-dialog__backdrop" />
        <BaseAlertDialog.Popup className={cn('ge-alert-dialog__popup', className)} {...rest}>
          <BaseAlertDialog.Title className="ge-alert-dialog__title">{title}</BaseAlertDialog.Title>
          {description && (
            <BaseAlertDialog.Description className="ge-alert-dialog__description">
              {description}
            </BaseAlertDialog.Description>
          )}
          {children}
          <div className="ge-alert-dialog__actions">
            <BaseAlertDialog.Close
              render={<Button variant="secondary" disabled={loading} />}
              data-testid="alert-dialog-cancel"
            >
              {cancelLabel}
            </BaseAlertDialog.Close>
            <Button
              variant={tone === 'danger' ? 'danger' : 'primary'}
              loading={loading}
              onClick={() => void onConfirm()}
              data-testid="alert-dialog-confirm"
            >
              {confirmLabel}
            </Button>
          </div>
        </BaseAlertDialog.Popup>
      </BaseAlertDialog.Portal>
    </BaseAlertDialog.Root>
  );
}
