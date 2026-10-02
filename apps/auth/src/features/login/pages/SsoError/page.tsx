import { useTranslation } from '@/core/locales';

import { SSO_ERROR_KEY } from '../../constants';
import { SsoErrorRoute } from '../../routes';
import { AuthShell } from '../AuthShell';
import { RestartLogin } from '../RestartLogin';

/**
 * provider 的協定錯誤頁（例：未登記的 redirect URI）。這類錯誤不能導回產品，所以在 IdP 自己的 origin 顯示
 * （docs/architecture/04-sso.md §12.2 D7）。
 */
export default function SsoErrorPage() {
  const { t } = useTranslation();
  const { error } = SsoErrorRoute.useSearch();
  return (
    <AuthShell title={t('login.error.title')}>
      <div className="flex flex-col gap-3">
        <p
          className="m-0 text-sm text-[var(--color-danger-text)]"
          data-testid="sso-error"
          data-value={error}
        >
          {t((error && SSO_ERROR_KEY[error]) ?? 'login.error.generic')}
        </p>
        {/* 協定錯誤不能導回產品：至少給使用者一條重新開始的路 */}
        <RestartLogin />
      </div>
    </AuthShell>
  );
}
