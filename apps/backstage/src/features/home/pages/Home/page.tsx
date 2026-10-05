import { Chip } from '@b2b-system/ui/Chip';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';

export default function HomePage() {
  const { t } = useTranslation();
  const { data } = useQuery(getAuthProfileQueryOptions());

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
          <dd className="m-0">{data?.user.displayName ?? '-'}</dd>
          <dt className="text-[var(--color-fg-muted)]">{t('home.you.email')}</dt>
          <dd className="m-0">{data?.user.email ?? '-'}</dd>
          <dt className="text-[var(--color-fg-muted)]">{t('home.you.roles')}</dt>
          <dd className="m-0 flex flex-wrap gap-1">
            {data?.roles.length
              ? data.roles.map((role) => (
                  <Chip key={role.id} tone={role.isSystem ? 'brand' : 'neutral'}>
                    {role.name}
                  </Chip>
                ))
              : t('common.none')}
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
