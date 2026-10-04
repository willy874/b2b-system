import { useState } from 'react';

import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import type { PlatformAdmin } from '@/shared/api-sdk';

import { PLATFORM_ADMIN_ROLE_LABEL_KEY, PLATFORM_ADMIN_ROLES } from '../../../constants';
import { useCreatePlatformAdminMutation } from '../../../hooks/usePlatformAdminMutations';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 預設給權限最小的角色，要更大的權限得明確選。 */
const DEFAULT_ROLE: PlatformAdmin['role'] = 'auditor';

interface CreatePlatformAdminDialogProps {
  open: boolean;
  onClose: () => void;
}

/** 新增平台管理者：email、名稱、角色。建立成待啟用，後端寄啟用信讓本人設定密碼。 */
export function CreatePlatformAdminDialog({ open, onClose }: CreatePlatformAdminDialogProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const create = useCreatePlatformAdminMutation();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<PlatformAdmin['role']>(DEFAULT_ROLE);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string>();
  const [wasOpen, setWasOpen] = useState(false);
  // 每次開啟從頭填（render 期間調整 state，不經過 effect）
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setEmail('');
      setDisplayName('');
      setRole(DEFAULT_ROLE);
      setSubmitted(false);
      setError(undefined);
    }
  }

  const invalid = {
    email: !EMAIL_PATTERN.test(email.trim()),
    displayName: !displayName.trim(),
  };

  const submit = async () => {
    setSubmitted(true);
    if (invalid.email || invalid.displayName) return;
    setError(undefined);
    try {
      await create.mutateAsync({
        params: {
          email: email.trim().toLowerCase(),
          displayName: displayName.trim(),
          role,
        },
      });
      onClose();
    } catch (caught) {
      setError(toMessage(caught));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t('platformAdmin.create.title')}
      data-testid="platform-admin-create-dialog"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={create.isPending}
            onClick={() => void submit()}
            data-testid="platform-admin-create-submit"
          >
            {t('common.create')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field
          label={t('platformAdmin.field.email')}
          description={t('platformAdmin.hint.email')}
          required
          error={submitted && invalid.email ? t('platformAdmin.error.emailInvalid') : undefined}
        >
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={254}
            autoComplete="off"
            data-testid="platform-admin-email-input"
          />
        </Field>
        <Field
          label={t('platformAdmin.field.displayName')}
          required
          error={
            submitted && invalid.displayName
              ? t('platformAdmin.error.displayNameRequired')
              : undefined
          }
        >
          <Input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={100}
            data-testid="platform-admin-display-name-input"
          />
        </Field>
        <Field label={t('platformAdmin.field.role')} required>
          <Select
            value={role}
            onValueChange={setRole}
            options={PLATFORM_ADMIN_ROLES.map((value) => ({
              value,
              label: t(PLATFORM_ADMIN_ROLE_LABEL_KEY[value]),
            }))}
            data-testid="platform-admin-role-select"
          />
        </Field>
        {error && (
          <p
            className="m-0 text-sm text-[var(--color-danger-text)]"
            data-testid="platform-admin-create-error"
          >
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
