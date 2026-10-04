import { useQuery } from '@tanstack/react-query';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { Chip } from '@/components/Chip';
import { useHasSession } from '@/core/auth';
import { useTranslation } from '@/core/locales';

import { HOME_ROLE_LABEL_KEY } from '../../constants';
import { useHomePermission } from '../../hooks/useHomePermission';
import { TenantOverview } from './components/TenantOverview';

/**
 * 平台首頁（結構同 backstage 的首頁）：目前登入的平台管理者（docs/architecture/05-tenancy.md §10.2 D5），
 * 有 `tenant:read` 時加上各狀態的租戶數。外部 IdP 連線屬於租戶，在各租戶的 backstage。
 */
export default function HomePage() {
  const { t } = useTranslation();
  // 登出時 session 先結束、頁面後切走：沒有 session 就不重抓，免得多打一個 401
  const hasSession = useHasSession();
  const { data } = useQuery({ ...getAuthProfileQueryOptions(), enabled: hasSession });
  const permission = useHomePermission();

  return (
    <div className="flex flex-col gap-6" data-testid="home-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('home.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t('home.description')}</p>
      </header>

      {permission.canViewTenants && <TenantOverview />}

      <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 className="m-0 text-base font-medium">{t('home.you.title')}</h2>
        <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-[var(--color-fg-muted)]">{t('home.you.displayName')}</dt>
          <dd className="m-0" data-testid="home-display-name">
            {data?.admin.displayName ?? '-'}
          </dd>
          <dt className="text-[var(--color-fg-muted)]">{t('home.you.email')}</dt>
          <dd className="m-0">{data?.admin.email ?? '-'}</dd>
          <dt className="text-[var(--color-fg-muted)]">{t('home.you.role')}</dt>
          <dd className="m-0">
            {data && <Chip tone="brand">{t(HOME_ROLE_LABEL_KEY[data.admin.role])}</Chip>}
          </dd>
          <dt className="text-[var(--color-fg-muted)]">{t('home.you.permissions')}</dt>
          <dd className="m-0" data-testid="home-permission-count">
            {data?.permissions.length ?? 0}
          </dd>
        </dl>
      </section>
    </div>
  );
}
