import { useState } from 'react';

import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
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
      onOpenChange={(next) => !next && onClose()}
      title={t('tenant.rename.title')}
      data-testid="tenant-rename-dialog"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
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
