import { Tabs } from '@b2b-system/ui/Tabs';
import { useTranslation } from '@b2b-system/web-core/locales';
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';

/** 安全性的分頁容器：每種政策一個分頁（目前只有 MFA）。 */
export default function SecurityLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const tabs = [{ value: '/security/mfa', label: t('security.mfa.tab') }];
  const current = tabs.find((tab) => pathname.startsWith(tab.value))?.value ?? tabs[0]!.value;
  return (
    <div className="flex flex-col gap-4" data-testid="security-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('security.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t('security.description')}</p>
      </header>
      <Tabs
        value={current}
        onValueChange={(to) => void navigate({ to })}
        tabs={tabs}
        moreLabel={t('common.more')}
        data-testid="security-tabs"
      />
      <Outlet />
    </div>
  );
}
