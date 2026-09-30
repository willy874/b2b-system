import { useState } from 'react';

import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import type { PlatformTenant } from '@/shared/api-sdk';

import { useDeleteTenantMutation } from '../../../hooks/useTenantMutations';

interface DeleteTenantDialogProps {
  open: boolean;
  tenant: PlatformTenant;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * 刪除租戶：影響整個租戶的所有使用者，所以要輸入租戶代碼才能按確認（type-to-confirm）。
 * 遮罩點擊不關閉；送出中兩顆按鈕都停用。
 */
export function DeleteTenantDialog({ open, tenant, onClose, onDeleted }: DeleteTenantDialogProps) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const remove = useDeleteTenantMutation();
  const [typed, setTyped] = useState('');
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTyped('');
  }
  const matches = typed.trim() === tenant.code;

  const submit = async () => {
    if (!matches || remove.isPending) return;
    try {
      await remove.mutateAsync({ params: { id: tenant.id } });
      onDeleted();
    } catch (caught) {
      showError(caught);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && !remove.isPending && onClose()}
      title={t('tenant.remove.title')}
      description={t('tenant.remove.confirm', { code: tenant.code })}
      dismissible={false}
      data-testid="tenant-remove-dialog"
      footer={
        <>
          <Button onClick={onClose} disabled={remove.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={!matches}
            loading={remove.isPending}
            onClick={() => void submit()}
            data-testid="tenant-remove-submit"
          >
            {t('common.delete')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label={t('tenant.remove.typeToConfirm', { code: tenant.code })}>
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            data-testid="tenant-remove-confirm-input"
          />
        </Field>
      </form>
    </Dialog>
  );
}
