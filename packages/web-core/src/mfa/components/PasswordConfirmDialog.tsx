import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { Input } from '@b2b-system/ui/Input';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { useTranslation } from '../../locales';
import { useMfaFormError } from './useMfaFormError';

export interface PasswordConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: ReactNode;
  danger?: boolean;
  /** 送出；拋錯時顯示訊息（例：AUTH_PASSWORD_MISMATCH）並留在對話框。 */
  onConfirm: (password: string) => Promise<void>;
  onClose: () => void;
  'data-testid'?: string;
}

/** 敏感的自助動作（移除驗證方式、重新產生備用碼）先再輸入一次密碼（docs/architecture/backend/21-mfa.md §7）。 */
export function PasswordConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
  ...rest
}: PasswordConfirmDialogProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const { error, fail, clear } = useMfaFormError();

  const close = () => {
    setPassword('');
    clear();
    onClose();
  };

  const submit = async () => {
    clear();
    setPending(true);
    try {
      await onConfirm(password);
      setPassword('');
    } catch (cause) {
      fail(cause);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title={title}
      description={description}
      size="sm"
      data-testid={rest['data-testid'] ?? 'mfa-password-dialog'}
      footer={
        <>
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={pending}
            disabled={!password}
            onClick={() => void submit()}
            data-testid="mfa-password-confirm"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (password) void submit();
        }}
      >
        <Field label={t('mfa.password.label')} required>
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            data-testid="mfa-password-input"
          />
        </Field>
        <FormError code={error?.code} data-testid="mfa-password-error">
          {error?.message}
        </FormError>
      </form>
    </Dialog>
  );
}
