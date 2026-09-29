import { useQuery } from '@tanstack/react-query';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { useHasSession } from '@/core/auth';
import { useTranslation } from '@/core/locales';

/**
 * 平台首頁：目前登入的平台管理者（docs/adr/0020-physical-tenant-isolation.md D5）。
 * 租戶管理在交付順序第 4 步加入；外部 IdP 連線屬於租戶，已搬到 backstage。
 */
export default function HomePage() {
  const { t } = useTranslation();
  // 登出時 session 先結束、頁面後切走：沒有 session 就不重抓，免得多打一個 401
  const hasSession = useHasSession();
  const { data } = useQuery({ ...getAuthProfileQueryOptions(), enabled: hasSession });

  return (
    <div className="flex flex-col gap-4" data-testid="home-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('home.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t('home.description')}</p>
      </header>

      <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 className="m-0 text-base font-medium">{t('home.you.title')}</h2>
        <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-[var(--color-fg-muted)]">{t('home.you.displayName')}</dt>
          <dd className="m-0" data-testid="home-display-name">
            {data?.admin.displayName ?? '-'}
          </dd>
          <dt className="text-[var(--color-fg-muted)]">{t('home.you.email')}</dt>
          <dd className="m-0">{data?.admin.email ?? '-'}</dd>
        </dl>
      </section>
    </div>
  );
}
