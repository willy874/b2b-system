import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Field } from '@b2b-system/ui/Field';
import { Input } from '@b2b-system/ui/Input';
import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useDialogUnsavedGuard } from '@b2b-system/web-core/router';
import { useState } from 'react';

import type { PlatformTenant } from '@/shared/api-sdk';

import { useUpdateTenantMutation } from '../../../hooks/useTenantMutations';

interface RenameTenantDialogProps {
  open: boolean;
  tenant: PlatformTenant;
  onClose: () => void;
}

export function RenameTenantDialog({ open, tenant, onClose }: RenameTenantDialogProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const update = useUpdateTenantMutation();
  const [name, setName] = useState(tenant.name);
  const [error, setError] = useState<string>();
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(tenant.name);
      setError(undefined);
    }
  }

  // 改了名稱時 Esc、點遮罩、取消與換頁都先確認；儲存成功直接關閉
  const guard = useDialogUnsavedGuard(open && name !== tenant.name, onClose);

  const submit = async () => {
    if (!name.trim()) {
      setError(t('tenant.error.nameRequired'));
      return;
    }
    try {
      await update.mutateAsync({ params: { id: tenant.id, body: { name: name.trim() } } });
      onClose();
    } catch (caught) {
      setError(toMessage(caught));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={guard.onOpenChange}
      title={t('tenant.rename.title')}
      data-testid="tenant-rename-dialog"
      footer={
        <>
          <Button onClick={guard.requestClose} data-testid="tenant-rename-cancel">
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={update.isPending}
            onClick={() => void submit()}
            data-testid="tenant-rename-submit"
          >
            {t('common.save')}
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
        <Field label={t('tenant.field.name')} required error={error}>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            data-testid="tenant-rename-input"
          />
        </Field>
      </form>
    </Dialog>
  );
}
