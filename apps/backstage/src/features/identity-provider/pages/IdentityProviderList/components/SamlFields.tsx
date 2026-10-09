import { Button, IconButton } from '@b2b-system/ui/Button';
import { Collapsible } from '@b2b-system/ui/Collapsible';
import { Field } from '@b2b-system/ui/Field';
import { Icon } from '@b2b-system/ui/Icon';
import { Input, Textarea } from '@b2b-system/ui/Input';
import { Select } from '@b2b-system/ui/Select';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { useState } from 'react';

import type { SamlSettings } from '@/shared/api-sdk';

import { NAME_ID_FORMATS } from '../adapter';
import type { FormErrors, IdentityProviderForm, NameIdFormat } from '../adapter';
import { parseIdpMetadata } from '../samlMetadata';
import type { MetadataParseError } from '../samlMetadata';

const NAME_ID_LABEL_KEY = {
  persistent: 'identityProvider.nameIdFormat.persistent',
  emailAddress: 'identityProvider.nameIdFormat.emailAddress',
  unspecified: 'identityProvider.nameIdFormat.unspecified',
} as const satisfies Record<NameIdFormat, string>;

const METADATA_ERROR_KEY = {
  invalidXml: 'identityProvider.metadata.error.invalidXml',
  noIdpDescriptor: 'identityProvider.metadata.error.noIdpDescriptor',
  noRedirectBinding: 'identityProvider.metadata.error.noRedirectBinding',
} as const satisfies Record<MetadataParseError, string>;

/** IdP 輪替憑證時新舊並存的上限（與後端相同）。 */
const MAX_CERTIFICATES = 3;

interface SamlFieldsProps {
  form: IdentityProviderForm;
  patch: (values: Partial<IdentityProviderForm>) => void;
  errors: FormErrors;
  /** 編輯時有：SP 的 entity ID 與已存的憑證摘要。 */
  saved: SamlSettings | null;
}

export function SamlFields({ form, patch, errors, saved }: SamlFieldsProps) {
  const { t } = useTranslation();
  const [metadata, setMetadata] = useState('');
  const [metadataResult, setMetadataResult] = useState<
    { ok: true; count: number } | { ok: false; error: MetadataParseError }
  >();

  const applyMetadata = () => {
    const parsed = parseIdpMetadata(metadata);
    if (!parsed.ok) {
      setMetadataResult(parsed);
      return;
    }
    patch({
      entityId: parsed.value.entityId,
      ssoUrl: parsed.value.ssoUrl,
      ...(parsed.value.certificates.length > 0 && { certificates: parsed.value.certificates }),
    });
    setMetadataResult({ ok: true, count: parsed.value.certificates.length });
  };

  const setCertificate = (index: number, value: string) =>
    patch({ certificates: form.certificates.map((pem, at) => (at === index ? value : pem)) });

  return (
    <>
      <Collapsible
        title={t('identityProvider.metadata.import')}
        data-testid="identity-provider-metadata-section"
      >
        <div className="flex flex-col gap-2">
          <Textarea
            value={metadata}
            onChange={(event) => setMetadata(event.target.value)}
            placeholder={t('identityProvider.metadata.placeholder')}
            rows={5}
            className="font-mono text-xs"
            aria-label={t('identityProvider.metadata.import')}
            data-testid="identity-provider-metadata-input"
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={!metadata.trim()}
              onClick={applyMetadata}
              data-testid="identity-provider-metadata-apply"
            >
              {t('identityProvider.metadata.apply')}
            </Button>
            {metadataResult && (
              <output
                className={
                  metadataResult.ok
                    ? 'text-xs text-[var(--color-fg-muted)]'
                    : 'text-xs text-[var(--color-danger-text)]'
                }
                data-testid="identity-provider-metadata-result"
              >
                {metadataResult.ok
                  ? t('identityProvider.metadata.applied', { count: metadataResult.count })
                  : t(METADATA_ERROR_KEY[metadataResult.error])}
              </output>
            )}
          </div>
        </div>
      </Collapsible>

      <Field
        label={t('identityProvider.field.entityId')}
        description={t('identityProvider.hint.entityId')}
        required
        error={errors.entityId ? t('identityProvider.error.entityIdRequired') : undefined}
      >
        <Input
          value={form.entityId}
          onChange={(event) => patch({ entityId: event.target.value })}
          placeholder="https://idp.example.com/metadata"
          maxLength={500}
          data-testid="identity-provider-entity-id-input"
        />
      </Field>
      <Field
        label={t('identityProvider.field.ssoUrl')}
        description={t('identityProvider.hint.ssoUrl')}
        required
        error={errors.ssoUrl ? t('identityProvider.error.ssoUrlInvalid') : undefined}
      >
        <Input
          value={form.ssoUrl}
          onChange={(event) => patch({ ssoUrl: event.target.value })}
          placeholder="https://idp.example.com/saml/sso"
          maxLength={2000}
          data-testid="identity-provider-sso-url-input"
        />
      </Field>

      {/* 多個輸入：用 fieldset 而不是 Field（Field 的 label 只對應一個控制項） */}
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 p-0 text-sm font-medium">
          {t('identityProvider.field.certificates')}
        </legend>
        <p className="m-0 text-xs text-[var(--color-fg-muted)]">
          {t('identityProvider.hint.certificates')}
        </p>
        {form.certificates.map((pem, index) => {
          const summary = saved?.certificates.find((item) => item.pem.trim() === pem.trim());
          const invalid = errors.certificates?.includes(index);
          return (
            // oxlint-disable-next-line react/no-array-index-key -- 憑證的內容會被編輯，位置就是它的身分
            <div key={index} className="flex items-start gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <Textarea
                  value={pem}
                  onChange={(event) => setCertificate(index, event.target.value)}
                  placeholder="-----BEGIN CERTIFICATE-----"
                  rows={4}
                  className="font-mono text-xs"
                  aria-label={t('identityProvider.certificate.label', { position: index + 1 })}
                  invalid={invalid}
                  data-testid="identity-provider-certificate-input"
                />
                {summary && (
                  <span
                    className="text-xs text-[var(--color-fg-muted)]"
                    data-testid="identity-provider-certificate-summary"
                  >
                    {t('identityProvider.certificate.summary', {
                      fingerprint: summary.fingerprint,
                      date: formatDateTime(summary.notAfter),
                    })}
                  </span>
                )}
                {invalid && (
                  <span className="text-xs text-[var(--color-danger-text)]">
                    {t('identityProvider.error.certificateInvalid')}
                  </span>
                )}
              </div>
              {form.certificates.length > 1 && (
                <IconButton
                  size="sm"
                  aria-label={t('identityProvider.certificate.remove')}
                  onClick={() =>
                    patch({ certificates: form.certificates.filter((_, at) => at !== index) })
                  }
                >
                  <Icon name="trash" size={16} />
                </IconButton>
              )}
            </div>
          );
        })}
        {form.certificates.length < MAX_CERTIFICATES && (
          <div>
            <Button
              size="sm"
              onClick={() => patch({ certificates: [...form.certificates, ''] })}
              data-testid="identity-provider-certificate-add"
            >
              <Icon name="plus" size={16} />
              {t('identityProvider.certificate.add')}
            </Button>
          </div>
        )}
      </fieldset>

      <Field
        label={t('identityProvider.field.nameIdFormat')}
        description={t('identityProvider.hint.nameIdFormat')}
      >
        <Select
          options={NAME_ID_FORMATS.map((value) => ({ value, label: t(NAME_ID_LABEL_KEY[value]) }))}
          value={form.nameIdFormat}
          onValueChange={(nameIdFormat) => patch({ nameIdFormat })}
          data-testid="identity-provider-name-id-select"
        />
      </Field>
      <Field
        label={t('identityProvider.field.emailAttribute')}
        description={t('identityProvider.hint.emailAttribute')}
      >
        <Input
          value={form.emailAttribute}
          onChange={(event) => patch({ emailAttribute: event.target.value })}
          maxLength={255}
          data-testid="identity-provider-email-attribute-input"
        />
      </Field>
      <Field label={t('identityProvider.field.nameAttribute')}>
        <Input
          value={form.nameAttribute}
          onChange={(event) => patch({ nameAttribute: event.target.value })}
          maxLength={255}
          data-testid="identity-provider-name-attribute-input"
        />
      </Field>
      {saved && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--color-fg-muted)]">{t('identityProvider.spEntityId')}</span>
          <Input
            readOnly
            value={saved.spEntityId}
            onFocus={(event) => event.target.select()}
            className="font-mono"
            data-testid="identity-provider-sp-entity-id"
          />
        </label>
      )}
    </>
  );
}
