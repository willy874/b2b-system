import { useQuery } from '@tanstack/react-query';

import { getPermissionListQueryOptions } from '@/apis/permission/get-permission-list/query';
import { Chip } from '@/components/Chip';
import { Skeleton } from '@/components/Skeleton';
import { useTranslation } from '@/core/locales';
import { usePermission } from '@/core/permission';

export default function PermissionListPage() {
  const { t } = useTranslation();
  const { permissions: mine } = usePermission();
  const { data, isPending } = useQuery(getPermissionListQueryOptions());

  return (
    <div className="flex flex-col gap-4" data-testid="permission-list-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('permissionCatalog.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          {t('permissionCatalog.description')}
        </p>
      </header>

      {isPending && <Skeleton height={200} />}

      {data?.groups.map((group) => (
        <section
          key={group.resource}
          className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
          data-testid={`permission-group-${group.resource}`}
        >
          <h2 className="m-0 mb-3 text-base font-medium">{t(group.nameI18nKey)}</h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {group.keys.map((key) => {
              const item = data.items.find((permission) => permission.key === key);
              return (
                <li key={key} className="flex items-center justify-between gap-4 text-sm">
                  <span>
                    {item ? t(item.nameI18nKey) : key}
                    <code className="ml-2 font-mono text-xs text-[var(--color-fg-muted)]">
                      {key}
                    </code>
                  </span>
                  {mine.has(key) ? (
                    <Chip tone="success">{t('permissionCatalog.held')}</Chip>
                  ) : (
                    <Chip tone="neutral">{t('permissionCatalog.notHeld')}</Chip>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
