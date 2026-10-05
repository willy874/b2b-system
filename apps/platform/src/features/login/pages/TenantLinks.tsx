import { useTranslation } from '@b2b-system/web-core/locales';

import { goToTenantLogin } from '../tenant';
import { AuthShell } from './AuthShell';

/** 帳號流程的網址沒有 `?tenant=`：不知道是哪個租戶的帳號，請從租戶的登入頁或信中連結進入。 */
export function TenantRequired({ title }: { title: string }) {
  const { t } = useTranslation();
  return (
    <AuthShell title={title}>
      <p className="m-0 text-sm text-[var(--color-danger-text)]" data-testid="tenant-required">
        {t('login.tenantRequired')}
      </p>
    </AuthShell>
  );
}

/** 回到那個租戶的 backstage 登入（docs/architecture/05-tenancy.md §10.2 D11）。 */
export function BackToTenantLogin({ tenant }: { tenant: string }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="cursor-pointer border-0 bg-transparent p-0 text-[var(--color-brand)]"
      onClick={() => void goToTenantLogin(tenant)}
      data-testid="back-to-tenant-login"
    >
      {t('login.backToLogin')}
    </button>
  );
}
