import { useTranslation } from '@b2b-system/web-core/locales';
import { RouteLink } from '@b2b-system/web-core/route-link';

import type { Group, RoleControllerListUsersResponse } from '@/shared/api-sdk';

interface RoleHolderSectionProps {
  /** 直接持有的使用者；沒有 user:read 時是 undefined（不顯示這一段） */
  holders: RoleControllerListUsersResponse['data']['items'] | undefined;
  /** 持有這個角色的群組（成員都經由它持有）；沒有 group:read 時是 undefined */
  groups: Group[] | undefined;
}

/** 持有此角色的使用者（連到 user feature 的詳情頁），以及經由群組持有的群組（docs/rbac/01-domain-model.md §9 G4）。 */
export function RoleHolderSection({ holders, groups }: RoleHolderSectionProps) {
  const { t } = useTranslation();

  return (
    <section>
      <h3 className="m-0 text-sm font-semibold">{t('role.detail.holders')}</h3>
      {holders && (
        <>
          <h4 className="mt-2 mb-0 text-xs font-medium text-[var(--color-fg-muted)]">
            {t('role.detail.directHolders')}
          </h4>
          <ul className="mt-1 flex list-none flex-col gap-1 p-0 text-sm">
            {holders.length ? (
              holders.map((holder) => (
                <li key={holder.id}>
                  <RouteLink
                    to="user.detail"
                    params={{ userId: holder.id }}
                    className="text-[var(--color-brand)]"
                  >
                    {holder.displayName}
                  </RouteLink>
                  <span className="ml-2 text-[var(--color-fg-muted)]">{holder.email}</span>
                </li>
              ))
            ) : (
              <li className="text-[var(--color-fg-muted)]">{t('common.none')}</li>
            )}
          </ul>
        </>
      )}
      {groups && (
        <>
          <h4 className="mt-3 mb-0 text-xs font-medium text-[var(--color-fg-muted)]">
            {t('role.detail.groupHolders')}
          </h4>
          <ul
            className="mt-1 flex list-none flex-col gap-1 p-0 text-sm"
            data-testid="role-holder-groups"
          >
            {groups.length ? (
              groups.map((group) => (
                <li key={group.id} data-testid="role-holder-group" data-value={group.id}>
                  <RouteLink
                    to="group.detail"
                    params={{ groupId: group.id }}
                    className="text-[var(--color-brand)]"
                  >
                    {group.name}
                  </RouteLink>
                  <span className="ml-2 text-[var(--color-fg-muted)]">
                    {t('role.detail.groupMemberCount', { count: group.memberCount })}
                  </span>
                </li>
              ))
            ) : (
              <li className="text-[var(--color-fg-muted)]">{t('common.none')}</li>
            )}
          </ul>
        </>
      )}
    </section>
  );
}
