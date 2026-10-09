import { Button, IconButton } from '@b2b-system/ui/Button';
import { Checkbox } from '@b2b-system/ui/Checkbox';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Field } from '@b2b-system/ui/Field';
import { FormError } from '@b2b-system/ui/FormError';
import { Icon } from '@b2b-system/ui/Icon';
import { Input } from '@b2b-system/ui/Input';
import { Select } from '@b2b-system/ui/Select';
import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useDialogUnsavedGuard } from '@b2b-system/web-core/router';
import { useState } from 'react';

import type { IdentityProvider, IdentityProviderDomain } from '@/shared/api-sdk';

import {
  useCreateIdentityProviderMutation,
  useUpdateIdentityProviderMutation,
} from '../../../hooks/useIdentityProviderMutations';
import {
  domainError,
  hasErrors,
  initialForm,
  isFormDirty,
  toCreateRequest,
  toUpdateRequest,
  validateForm,
} from '../adapter';
import type { IdentityProviderForm, Protocol, UnmatchedPolicy } from '../adapter';
import { OidcFields } from './OidcFields';
import { SamlFields } from './SamlFields';

interface IdentityProviderFormDialogProps {
  open: boolean;
  /** 有值是編輯（secret 留空表示不變更、協定不能換），沒有是建立。 */
  provider?: IdentityProvider;
  onClose: () => void;
}

/** 外部 IdP 連線的新增與編輯（OIDC 與 SAML 2.0，docs/architecture/04-sso.md §3.3）。 */
export function IdentityProviderFormDialog({
  open,
  provider,
  onClose,
}: IdentityProviderFormDialogProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const create = useCreateIdentityProviderMutation();
  const update = useUpdateIdentityProviderMutation();
  const [form, setForm] = useState<IdentityProviderForm>(() => initialForm(provider));
  const [initial, setInitial] = useState<IdentityProviderForm>(form);
  const [nextKey, setNextKey] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string>();
  const [openedFor, setOpenedFor] = useState<{ open: boolean; provider?: IdentityProvider }>({
    open: false,
  });
  // 每次開啟從頭填（render 期間調整 state，不經過 effect）
  if (open !== openedFor.open || provider !== openedFor.provider) {
    setOpenedFor({ open, provider });
    if (open) {
      const fresh = initialForm(provider);
      setForm(fresh);
      setInitial(fresh);
      setNextKey(fresh.domains.length);
      setSubmitted(false);
      setError(undefined);
    }
  }

  const patch = (values: Partial<IdentityProviderForm>) =>
    setForm((current) => ({ ...current, ...values }));
  const errors = validateForm(form, Boolean(provider));
  const shownErrors = submitted ? errors : {};
  // 欄位多、client secret 還要回 IdP 重新取得：有改動時 Esc、點遮罩、取消與換頁都先確認
  const guard = useDialogUnsavedGuard(open && isFormDirty(form, initial), onClose);

  const patchDomain = (key: number, values: Partial<IdentityProviderDomain>) =>
    patch({
      domains: form.domains.map((row) => (row.key === key ? { ...row, ...values } : row)),
    });

  const submit = async () => {
    setSubmitted(true);
    if (hasErrors(errors)) return;
    setError(undefined);
    try {
      if (provider) {
        await update.mutateAsync({ params: { id: provider.id, body: toUpdateRequest(form) } });
      } else {
        await create.mutateAsync({ params: toCreateRequest(form) });
      }
      onClose();
    } catch (caught) {
      setError(toMessage(caught));
    }
  };

  const protocolOptions: Array<{ value: Protocol; label: string }> = [
    { value: 'oidc', label: t('identityProvider.protocol.oidc') },
    { value: 'saml', label: t('identityProvider.protocol.saml') },
  ];
  const policyOptions: Array<{ value: UnmatchedPolicy; label: string }> = [
    { value: 'reject', label: t('identityProvider.policy.reject') },
    { value: 'auto_create', label: t('identityProvider.policy.auto_create') },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={guard.onOpenChange}
      title={provider ? t('identityProvider.edit.title') : t('identityProvider.create.title')}
      data-testid="identity-provider-form-dialog"
      footer={
        <>
          <Button onClick={guard.requestClose} data-testid="identity-provider-form-cancel">
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={create.isPending || update.isPending}
            onClick={() => void submit()}
            data-testid="identity-provider-form-submit"
          >
            {provider ? t('common.save') : t('common.create')}
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
          label={t('identityProvider.field.protocol')}
          description={provider ? t('identityProvider.hint.protocolLocked') : undefined}
        >
          <Select
            options={protocolOptions}
            value={form.protocol}
            onValueChange={(protocol) => patch({ protocol })}
            disabled={Boolean(provider)}
            data-testid="identity-provider-protocol-select"
          />
        </Field>
        <Field
          label={t('identityProvider.field.name')}
          description={t('identityProvider.hint.name')}
          required
          error={shownErrors.name ? t('identityProvider.error.nameRequired') : undefined}
        >
          <Input
            value={form.name}
            onChange={(event) => patch({ name: event.target.value })}
            maxLength={64}
            data-testid="identity-provider-name-input"
          />
        </Field>

        {form.protocol === 'oidc' ? (
          <OidcFields form={form} patch={patch} errors={shownErrors} editing={Boolean(provider)} />
        ) : (
          <SamlFields
            form={form}
            patch={patch}
            errors={shownErrors}
            saved={provider?.saml ?? null}
          />
        )}

        {/* 多個輸入：用 fieldset 而不是 Field（Field 的 label 只對應一個控制項） */}
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-sm font-medium">
            {t('identityProvider.field.domains')}
          </legend>
          <p className="m-0 text-xs text-[var(--color-fg-muted)]">
            {t('identityProvider.hint.domains')}
          </p>
          {form.domains.map((row) => {
            const rowError = submitted ? domainError(form.domains, row) : undefined;
            return (
              <div key={row.key} className="flex items-start gap-2">
                <div className="flex flex-1 flex-col gap-1">
                  <Input
                    value={row.domain}
                    onChange={(event) => patchDomain(row.key, { domain: event.target.value })}
                    placeholder={t('identityProvider.domain.placeholder')}
                    aria-invalid={Boolean(rowError)}
                    maxLength={253}
                    data-testid="identity-provider-domain-input"
                  />
                  {rowError && (
                    <span className="text-xs text-[var(--color-danger-text)]">
                      {rowError === 'invalid'
                        ? t('identityProvider.error.domainInvalid')
                        : t('identityProvider.error.domainDuplicate')}
                    </span>
                  )}
                </div>
                <Checkbox
                  className="mt-2"
                  checked={row.ssoOnly}
                  onCheckedChange={(checked) => patchDomain(row.key, { ssoOnly: checked })}
                  label={t('identityProvider.domain.ssoOnly')}
                  data-testid="identity-provider-domain-sso-only"
                />
                <IconButton
                  size="sm"
                  aria-label={t('identityProvider.domain.remove')}
                  onClick={() =>
                    patch({ domains: form.domains.filter((item) => item.key !== row.key) })
                  }
                >
                  <Icon name="trash" size={16} />
                </IconButton>
              </div>
            );
          })}
          <div>
            <Button
              size="sm"
              onClick={() => {
                patch({ domains: [...form.domains, { key: nextKey, domain: '', ssoOnly: false }] });
                setNextKey((key) => key + 1);
              }}
              data-testid="identity-provider-domain-add"
            >
              <Icon name="plus" size={16} />
              {t('identityProvider.domain.add')}
            </Button>
          </div>
        </fieldset>

        <Field
          label={t('identityProvider.field.unmatchedPolicy')}
          description={
            form.unmatchedPolicy === 'auto_create'
              ? t('identityProvider.policy.autoCreateHint')
              : undefined
          }
        >
          <Select
            options={policyOptions}
            value={form.unmatchedPolicy}
            onValueChange={(unmatchedPolicy) => patch({ unmatchedPolicy })}
            data-testid="identity-provider-policy-select"
          />
        </Field>
        <Checkbox
          checked={form.enabled}
          onCheckedChange={(enabled) => patch({ enabled })}
          label={t('identityProvider.field.enabled')}
          data-testid="identity-provider-enabled"
        />
        <FormError data-testid="identity-provider-form-error">{error}</FormError>
      </form>
    </Dialog>
  );
}
