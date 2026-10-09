import { Field } from '@b2b-system/ui/Field';
import { Input } from '@b2b-system/ui/Input';
import { Select } from '@b2b-system/ui/Select';
import { useTranslation } from '@b2b-system/web-core/locales';

import { issuerOf, OIDC_PRESETS } from '../adapter';
import type { FormErrors, IdentityProviderForm, Preset } from '../adapter';

/** 範本的名稱與說明（docs/architecture/04-sso.md §3.3.1）。 */
const PRESET_LABEL_KEY = {
  generic: 'identityProvider.preset.generic',
  google: 'identityProvider.preset.google',
  microsoft: 'identityProvider.preset.microsoft',
  okta: 'identityProvider.preset.okta',
  keycloak: 'identityProvider.preset.keycloak',
} as const satisfies Record<Preset, string>;

const PRESET_HINT_KEY = {
  generic: 'identityProvider.presetHint.generic',
  google: 'identityProvider.presetHint.google',
  microsoft: 'identityProvider.presetHint.microsoft',
  okta: 'identityProvider.presetHint.okta',
  keycloak: 'identityProvider.presetHint.keycloak',
} as const satisfies Record<Preset, string>;

const ISSUER_PLACEHOLDER: Record<Preset, string> = {
  generic: 'https://idp.example.com',
  google: 'https://accounts.google.com',
  microsoft: 'https://login.microsoftonline.com/<directory-id>/v2.0',
  okta: 'https://acme.okta.com',
  keycloak: 'https://sso.example.com/realms/staff',
};

interface OidcFieldsProps {
  form: IdentityProviderForm;
  patch: (values: Partial<IdentityProviderForm>) => void;
  /** 送出過才顯示錯誤。 */
  errors: FormErrors;
  editing: boolean;
}

export function OidcFields({ form, patch, errors, editing }: OidcFieldsProps) {
  const { t } = useTranslation();
  const presetOptions = OIDC_PRESETS.map((value) => ({
    value,
    label: t(PRESET_LABEL_KEY[value]),
  }));

  return (
    <>
      <Field
        label={t('identityProvider.field.preset')}
        description={t(PRESET_HINT_KEY[form.preset])}
      >
        <Select
          options={presetOptions}
          value={form.preset}
          onValueChange={(preset) => patch({ preset })}
          data-testid="identity-provider-preset-select"
        />
      </Field>
      {form.preset === 'microsoft' ? (
        <Field
          label={t('identityProvider.field.directoryId')}
          description={t('identityProvider.hint.directoryId', { issuer: issuerOf(form) })}
          required
          error={errors.directoryId ? t('identityProvider.error.directoryIdInvalid') : undefined}
        >
          <Input
            value={form.directoryId}
            onChange={(event) => patch({ directoryId: event.target.value })}
            placeholder="00000000-0000-0000-0000-000000000000"
            maxLength={36}
            data-testid="identity-provider-directory-id-input"
          />
        </Field>
      ) : (
        <Field
          label={t('identityProvider.field.issuer')}
          description={t('identityProvider.hint.issuer')}
          required
          error={errors.issuer ? t('identityProvider.error.issuerInvalid') : undefined}
        >
          <Input
            value={form.preset === 'google' ? issuerOf(form) : form.issuer}
            readOnly={form.preset === 'google'}
            onChange={(event) => patch({ issuer: event.target.value })}
            placeholder={ISSUER_PLACEHOLDER[form.preset]}
            maxLength={500}
            data-testid="identity-provider-issuer-input"
          />
        </Field>
      )}
      <Field
        label={t('identityProvider.field.clientId')}
        required
        error={errors.clientId ? t('identityProvider.error.clientIdRequired') : undefined}
      >
        <Input
          value={form.clientId}
          onChange={(event) => patch({ clientId: event.target.value })}
          maxLength={255}
          data-testid="identity-provider-client-id-input"
        />
      </Field>
      <Field
        label={t('identityProvider.field.clientSecret')}
        description={
          editing
            ? t('identityProvider.hint.clientSecretKeep')
            : t('identityProvider.hint.clientSecret')
        }
        required={!editing}
        error={errors.clientSecret ? t('identityProvider.error.clientSecretRequired') : undefined}
      >
        <Input
          type="password"
          autoComplete="new-password"
          value={form.clientSecret}
          onChange={(event) => patch({ clientSecret: event.target.value })}
          maxLength={2000}
          data-testid="identity-provider-client-secret-input"
        />
      </Field>
      <Field
        label={t('identityProvider.field.scopes')}
        error={errors.scopes ? t('identityProvider.error.scopesInvalid') : undefined}
      >
        <Input
          value={form.scopes}
          onChange={(event) => patch({ scopes: event.target.value })}
          maxLength={500}
          data-testid="identity-provider-scopes-input"
        />
      </Field>
    </>
  );
}
