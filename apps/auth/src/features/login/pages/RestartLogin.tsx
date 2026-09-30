import { ButtonLink } from '@/components/Button';
import { useTranslation } from '@/core/locales';

import { EnterTenantRoute, LoginRoute } from '../routes';

interface RestartLoginProps {
  /** 互動屬於哪個租戶：知道時直接回到那個租戶的登入（`/enter?tenant=` 會自動前往）。 */
  tenant?: string;
  /** 平台管理者的互動（沒有租戶的 auth client）：回到 apps/auth 自己的登入。 */
  platform?: boolean;
}

/**
 * 登入互動過期或 provider 的協定錯誤之後的下一步（UX-28）：不要讓使用者停在沒有出口的頁面。
 * 不知道是哪一種登入時，主要動作是「進入租戶」，另附平台管理者的登入。
 */
export function RestartLogin({ tenant, platform }: RestartLoginProps) {
  const { t } = useTranslation();
  if (platform) {
    return (
      <ButtonLink to={LoginRoute.to} variant="primary" block data-testid="login-restart">
        {t('login.restart.action')}
      </ButtonLink>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <ButtonLink
        to={EnterTenantRoute.to}
        search={tenant ? { tenant } : {}}
        variant="primary"
        block
        data-testid="login-restart"
        data-value={tenant}
      >
        {t('login.restart.action')}
      </ButtonLink>
      {!tenant && (
        <ButtonLink
          to={LoginRoute.to}
          variant="ghost"
          block
          size="sm"
          data-testid="login-restart-platform"
        >
          {t('login.restart.platform')}
        </ButtonLink>
      )}
    </div>
  );
}
