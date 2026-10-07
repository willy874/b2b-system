import { useTranslation } from '@b2b-system/web-core/locales';

interface InteractionFooterProps {
  /** 帶租戶的互動；沒有租戶是平台管理者的登入 */
  tenantCode: string | undefined;
  /** 租戶開放註冊（`auth.registrationEnabled`），而且已經載入 */
  showRegister: boolean;
}

/**
 * 登入卡片的頁尾。帳號流程是租戶帳號的；平台管理者由其他平台管理者建立與重設。
 * 沒有租戶的互動是平台管理者的登入：走錯地方的租戶使用者從這裡去自己的租戶（D11）。
 */
export function InteractionFooter({ tenantCode, showRegister }: InteractionFooterProps) {
  const { t } = useTranslation();
  if (!tenantCode) {
    return (
      <a className="text-[var(--color-brand)]" href="/enter" data-testid="login-enter-tenant-link">
        {t('login.interaction.enterTenant')}
      </a>
    );
  }
  const tenantQuery = `?${new URLSearchParams({ tenant: tenantCode }).toString()}`;
  return (
    <div className="flex justify-between gap-2">
      <a
        className="text-[var(--color-brand)]"
        href={`/forgot-password${tenantQuery}`}
        data-testid="login-forgot-password-link"
      >
        {t('login.interaction.forgotPassword')}
      </a>
      {showRegister && (
        <a
          className="text-[var(--color-brand)]"
          href={`/register${tenantQuery}`}
          data-testid="login-register-link"
        >
          {t('login.interaction.register')}
        </a>
      )}
    </div>
  );
}
