import { useState } from 'react';

import { Button, IconButton } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import type { IdentityProvider, IdentityProviderDomain } from '@/shared/api-sdk';

import {
  useCreateIdentityProviderMutation,
  useUpdateIdentityProviderMutation,
} from '../../../hooks/useIdentityProviderMutations';

/** 與後端 `DomainSchema` 相同。 */
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
const DEFAULT_SCOPES = 'openid email profile';

type UnmatchedPolicy = IdentityProvider['unmatchedPolicy'];

interface DomainRow extends IdentityProviderDomain {
  /** 列的穩定 key（網域本身會被編輯）。 */
  key: number;
}

function isUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function domainError(rows: DomainRow[], row: DomainRow): 'invalid' | 'duplicate' | undefined {
  const domain = row.domain.trim().toLowerCase();
  if (!DOMAIN_PATTERN.test(domain)) return 'invalid';
  const same = rows.filter((other) => other.domain.trim().toLowerCase() === domain);
  return same.length > 1 && same[0] !== row ? 'duplicate' : undefined;
}

interface IdentityProviderFormDialogProps {
  open: boolean;
  /** 有值是編輯（secret 留空表示不變更），沒有是建立。 */
  provider?: IdentityProvider;
  onClose: () => void;
}

export function IdentityProviderFormDialog({
  open,
  provider,
  onClose,
}: IdentityProviderFormDialogProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const create = useCreateIdentityProviderMutation();
  const update = useUpdateIdentityProviderMutation();
  const [name, setName] = useState('');
  const [issuer, setIssuer] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [scopes, setScopes] = useState(DEFAULT_SCOPES);
  const [enabled, setEnabled] = useState(true);
  const [unmatchedPolicy, setUnmatchedPolicy] = useState<UnmatchedPolicy>('reject');
  const [domains, setDomains] = useState<DomainRow[]>([]);
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
      setName(provider?.name ?? '');
      setIssuer(provider?.issuer ?? '');
      setClientId(provider?.clientId ?? '');
      setClientSecret('');
      setScopes(provider?.scopes ?? DEFAULT_SCOPES);
      setEnabled(provider?.enabled ?? true);
      setUnmatchedPolicy(provider?.unmatchedPolicy ?? 'reject');
      const rows = (provider?.domains ?? []).map((domain, index) => ({ ...domain, key: index }));
      setDomains(rows);
      setNextKey(rows.length);
      setSubmitted(false);
      setError(undefined);
    }
  }

  const invalid = {
    name: !name.trim(),
    issuer: !isUrl(issuer.trim()),
    clientId: !clientId.trim(),
    clientSecret: !provider && !clientSecret,
    scopes: !scopes.trim().split(/\s+/).includes('openid'),
    domains: domains.some((row) => domainError(domains, row)),
  };
  const hasInvalid = Object.values(invalid).some(Boolean);

  const patchDomain = (key: number, patch: Partial<IdentityProviderDomain>) =>
    setDomains((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const submit = async () => {
    setSubmitted(true);
    if (hasInvalid) return;
    setError(undefined);
    const body = {
      name: name.trim(),
      issuer: issuer.trim(),
      clientId: clientId.trim(),
      scopes: scopes.trim().split(/\s+/).join(' '),
      enabled,
      unmatchedPolicy,
      domains: domains.map(({ domain, ssoOnly }) => ({
        domain: domain.trim().toLowerCase(),
        ssoOnly,
      })),
    };
    try {
      if (provider) {
        await update.mutateAsync({
          params: { id: provider.id, body: { ...body, clientSecret: clientSecret || undefined } },
        });
      } else {
        await create.mutateAsync({ params: { ...body, clientSecret } });
      }
      onClose();
    } catch (caught) {
      setError(toMessage(caught));
    }
  };

  const policyOptions: Array<{ value: UnmatchedPolicy; label: string }> = [
    { value: 'reject', label: t('identityProvider.policy.reject') },
    { value: 'auto_create', label: t('identityProvider.policy.auto_create') },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={provider ? t('identityProvider.edit.title') : t('identityProvider.create.title')}
      data-testid="identity-provider-form-dialog"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
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
          label={t('identityProvider.field.name')}
          description={t('identityProvider.hint.name')}
          required
          error={submitted && invalid.name ? t('identityProvider.error.nameRequired') : undefined}
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={64}
            data-testid="identity-provider-name-input"
          />
        </Field>
        <Field
          label={t('identityProvider.field.issuer')}
          description={t('identityProvider.hint.issuer')}
          required
          error={
            submitted && invalid.issuer ? t('identityProvider.error.issuerInvalid') : undefined
          }
        >
          <Input
            value={issuer}
            onChange={(event) => setIssuer(event.target.value)}
            placeholder="https://login.microsoftonline.com/<tenant>/v2.0"
            maxLength={500}
            data-testid="identity-provider-issuer-input"
          />
        </Field>
        <Field
          label={t('identityProvider.field.clientId')}
          required
          error={
            submitted && invalid.clientId ? t('identityProvider.error.clientIdRequired') : undefined
          }
        >
          <Input
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            maxLength={255}
            data-testid="identity-provider-client-id-input"
          />
        </Field>
        <Field
          label={t('identityProvider.field.clientSecret')}
          description={
            provider
              ? t('identityProvider.hint.clientSecretKeep')
              : t('identityProvider.hint.clientSecret')
          }
          required={!provider}
          error={
            submitted && invalid.clientSecret
              ? t('identityProvider.error.clientSecretRequired')
              : undefined
          }
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            maxLength={2000}
            data-testid="identity-provider-client-secret-input"
          />
        </Field>
        <Field
          label={t('identityProvider.field.scopes')}
          error={
            submitted && invalid.scopes ? t('identityProvider.error.scopesInvalid') : undefined
          }
        >
          <Input
            value={scopes}
            onChange={(event) => setScopes(event.target.value)}
            maxLength={500}
            data-testid="identity-provider-scopes-input"
          />
        </Field>

        {/* 多個輸入：用 fieldset 而不是 Field（Field 的 label 只對應一個控制項） */}
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-sm font-medium">
            {t('identityProvider.field.domains')}
          </legend>
          <p className="m-0 text-xs text-[var(--color-fg-muted)]">
            {t('identityProvider.hint.domains')}
          </p>
          {domains.map((row) => {
            const rowError = submitted ? domainError(domains, row) : undefined;
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
                  onClick={() => setDomains((rows) => rows.filter((item) => item.key !== row.key))}
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
                setDomains((rows) => [...rows, { key: nextKey, domain: '', ssoOnly: false }]);
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
            unmatchedPolicy === 'auto_create'
              ? t('identityProvider.policy.autoCreateHint')
              : undefined
          }
        >
          <Select
            options={policyOptions}
            value={unmatchedPolicy}
            onValueChange={setUnmatchedPolicy}
            data-testid="identity-provider-policy-select"
          />
        </Field>
        <Checkbox
          checked={enabled}
          onCheckedChange={setEnabled}
          label={t('identityProvider.field.enabled')}
          data-testid="identity-provider-enabled"
        />
        {error && <p className="m-0 text-sm text-[var(--color-danger-text)]">{error}</p>}
      </form>
    </Dialog>
  );
}
