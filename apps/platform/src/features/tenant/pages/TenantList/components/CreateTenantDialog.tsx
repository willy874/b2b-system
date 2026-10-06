import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { Input } from '@b2b-system/ui/Input';
import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useDialogUnsavedGuard } from '@b2b-system/web-core/router';
import { useState } from 'react';

import { RESERVED_TENANT_CODES, TENANT_CODE_PATTERN } from '../../../constants';
import { useCreateTenantMutation } from '../../../hooks/useTenantMutations';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface CreateTenantDialogProps {
  open: boolean;
  /** 預設網域的上層（`acme` → `acme.<baseDomain>`）。 */
  baseDomain: string;
  onClose: () => void;
  /** 建立成功（回應時還在佈建中）。 */
  onCreated: (id: string) => void;
}

function codeError(code: string): 'required' | 'invalid' | 'reserved' | undefined {
  if (!code) return 'required';
  if (!TENANT_CODE_PATTERN.test(code)) return 'invalid';
  return RESERVED_TENANT_CODES.has(code) ? 'reserved' : undefined;
}

const CODE_ERROR_KEY = {
  required: 'tenant.error.codeRequired',
  invalid: 'tenant.error.codeInvalid',
  reserved: 'tenant.error.codeReserved',
} as const satisfies Record<NonNullable<ReturnType<typeof codeError>>, string>;

/**
 * 建立租戶（docs/architecture/05-tenancy.md §10.2 D12）：代碼、名稱、第一位管理員。
 * 送出後由背景工作佈建（database、migration、管理員的啟用信），這裡不等佈建完成。
 */
export function CreateTenantDialog({
  open,
  baseDomain,
  onClose,
  onCreated,
}: CreateTenantDialogProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const create = useCreateTenantMutation();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string>();
  const [wasOpen, setWasOpen] = useState(false);
  // 每次開啟從頭填（render 期間調整 state，不經過 effect）
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setCode('');
      setName('');
      setAdminEmail('');
      setAdminName('');
      setSubmitted(false);
      setError(undefined);
    }
  }

  const normalizedCode = code.trim().toLowerCase();
  const invalid = {
    code: codeError(normalizedCode),
    name: !name.trim(),
    adminEmail: !EMAIL_PATTERN.test(adminEmail.trim()),
  };
  const hasInvalid = Boolean(invalid.code) || invalid.name || invalid.adminEmail;
  // 有輸入時 Esc、點遮罩、取消與換頁都先確認；建立成功由呼叫端關閉
  const guard = useDialogUnsavedGuard(
    open && Boolean(code || name || adminEmail || adminName),
    onClose,
  );

  const submit = async () => {
    setSubmitted(true);
    if (hasInvalid) return;
    setError(undefined);
    try {
      const tenant = await create.mutateAsync({
        params: {
          code: normalizedCode,
          name: name.trim(),
          adminEmail: adminEmail.trim().toLowerCase(),
          adminName: adminName.trim() || undefined,
          domains: [],
        },
      });
      onCreated(tenant.id);
    } catch (caught) {
      setError(toMessage(caught));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={guard.onOpenChange}
      title={t('tenant.create.title')}
      data-testid="tenant-create-dialog"
      footer={
        <>
          <Button onClick={guard.requestClose} data-testid="tenant-create-cancel">
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={create.isPending}
            onClick={() => void submit()}
            data-testid="tenant-create-submit"
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
          label={t('tenant.field.code')}
          description={t('tenant.hint.code', {
            domain: `${normalizedCode || 'acme'}.${baseDomain}`,
          })}
          required
          error={submitted && invalid.code ? t(CODE_ERROR_KEY[invalid.code]) : undefined}
        >
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            maxLength={32}
            autoComplete="off"
            data-testid="tenant-code-input"
          />
        </Field>
        <Field
          label={t('tenant.field.name')}
          required
          error={submitted && invalid.name ? t('tenant.error.nameRequired') : undefined}
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            data-testid="tenant-name-input"
          />
        </Field>
        <Field
          label={t('tenant.field.adminEmail')}
          description={t('tenant.hint.adminEmail')}
          required
          error={submitted && invalid.adminEmail ? t('tenant.error.adminEmailInvalid') : undefined}
        >
          <Input
            type="email"
            value={adminEmail}
            onChange={(event) => setAdminEmail(event.target.value)}
            maxLength={254}
            data-testid="tenant-admin-email-input"
          />
        </Field>
        <Field label={t('tenant.field.adminName')}>
          <Input
            value={adminName}
            onChange={(event) => setAdminName(event.target.value)}
            maxLength={100}
            data-testid="tenant-admin-name-input"
          />
        </Field>
        <FormError data-testid="tenant-create-error">{error}</FormError>
      </form>
    </Dialog>
  );
}
