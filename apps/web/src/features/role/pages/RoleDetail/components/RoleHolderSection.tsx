import { Link } from '@tanstack/react-router';

import { useTranslation } from '@/core/locales';
import type { RoleControllerListUsersResponse } from '@/shared/api-sdk';

import { ExternalRoutes } from '../../../routes';

interface RoleHolderSectionProps {
  holders: RoleControllerListUsersResponse['data']['items'] | undefined;
}

/** 持有此角色的使用者，連到 user feature 的詳情頁。 */
export function RoleHolderSection({ holders }: RoleHolderSectionProps) {
  const { t } = useTranslation();

  return (
    <section>
      <h3 className="m-0 text-sm font-semibold">{t('role.detail.holders')}</h3>
      <ul className="mt-2 flex list-none flex-col gap-1 p-0 text-sm">
        {holders?.length ? (
          holders.map((holder) => (
            <li key={holder.id}>
              <Link
                to={ExternalRoutes.UserDetailRoute.to}
                params={{ userId: holder.id }}
                search={{}}
                className="text-[var(--color-brand)]"
              >
                {holder.displayName}
              </Link>
              <span className="ml-2 text-[var(--color-fg-muted)]">{holder.email}</span>
            </li>
          ))
        ) : (
          <li className="text-[var(--color-fg-muted)]">{t('common.none')}</li>
        )}
      </ul>
    </section>
  );
}
