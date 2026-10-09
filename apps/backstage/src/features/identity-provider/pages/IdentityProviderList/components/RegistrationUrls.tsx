import { Input } from '@b2b-system/ui/Input';
import { useTranslation } from '@b2b-system/web-core/locales';

interface RegistrationUrlsProps {
  callbackUrl: string;
  samlAcsUrl: string;
}

/** 要登記在外部 IdP 的網址：OIDC 的 redirect URI、SAML 的 ACS（所有連線共用，docs/architecture/04-sso.md §3.3）。 */
export function RegistrationUrls({ callbackUrl, samlAcsUrl }: RegistrationUrlsProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-4">
      <label className="flex min-w-80 flex-1 flex-col gap-1 text-sm">
        <span className="text-[var(--color-fg-muted)]">{t('identityProvider.callbackUrl')}</span>
        <Input
          readOnly
          value={callbackUrl}
          onFocus={(event) => event.target.select()}
          className="font-mono"
          data-testid="identity-provider-callback-url"
        />
      </label>
      <label className="flex min-w-80 flex-1 flex-col gap-1 text-sm">
        <span className="text-[var(--color-fg-muted)]">{t('identityProvider.samlAcsUrl')}</span>
        <Input
          readOnly
          value={samlAcsUrl}
          onFocus={(event) => event.target.select()}
          className="font-mono"
          data-testid="identity-provider-saml-acs-url"
        />
      </label>
    </div>
  );
}
