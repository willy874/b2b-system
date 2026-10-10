import { Pagination } from '@b2b-system/ui/Pagination';
import { QuerySection } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { RouteLink } from '@b2b-system/web-core/route-link';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getGroupListQueryOptions } from '@/apis/group/get-group-list/query';
import { getRoleUsersQueryOptions } from '@/apis/role/get-role-users/query';

/** 直接持有者一頁幾位 */
const HOLDER_PAGE_SIZE = 20;
/** 經由群組持有的群組一頁幾個 */
const GROUP_PAGE_SIZE = 20;

interface RoleHolderSectionProps {
  roleId: string;
  /** 有 user:read：列出直接持有的使用者 */
  canViewUsers: boolean;
  /** 有 group:read 且租戶啟用 group：列出持有這個角色的群組（成員都經由它持有） */
  canViewGroups: boolean;
}

/**
 * 持有此角色的使用者（連到 user feature 的詳情頁），以及經由群組持有的群組（docs/architecture/iam/01-model.md §9 G4）。
 * 兩份清單都分頁：只列第一頁會讓人以為只有這些人持有角色（例如稽核「誰有 admin」時漏看）。
 */
export function RoleHolderSection({ roleId, canViewUsers, canViewGroups }: RoleHolderSectionProps) {
  const { t } = useTranslation();
  const [holderOffset, setHolderOffset] = useState(0);
  const [groupOffset, setGroupOffset] = useState(0);
  const holders = useQuery({
    ...getRoleUsersQueryOptions(roleId, holderOffset, HOLDER_PAGE_SIZE),
    enabled: canViewUsers,
  });
  const groups = useQuery({
    ...getGroupListQueryOptions({
      params: {
        offset: groupOffset,
        limit: GROUP_PAGE_SIZE,
        roleId,
        sort: [{ sort: 'name', order: 'asc' }],
      },
    }),
    enabled: canViewGroups,
  });

  return (
    <section>
      <h3 className="m-0 text-sm font-semibold">{t('role.detail.holders')}</h3>
      {canViewUsers && (
        <>
          <h4 className="mt-2 mb-0 text-xs font-medium text-[var(--color-fg-muted)]">
            {t('role.detail.directHolders')}
          </h4>
          <div className="mt-1">
            <QuerySection query={holders} data-testid="role-holder-users-error">
              {({ items, pagination }) => (
                <>
                  <ul className="flex list-none flex-col gap-1 p-0 text-sm">
                    {items.length ? (
                      items.map((holder) => (
                        <li key={holder.id} data-testid="role-holder-user" data-value={holder.id}>
                          {holder.kind === 'service' ? (
                            // 服務帳號：只在對外 API 開放時由 api 列出（docs/architecture/05-tenancy.md §15.2 D4），連到服務帳號頁
                            <>
                              <RouteLink
                                to="serviceAccount.detail"
                                params={{ serviceAccountId: holder.id }}
                                className="text-[var(--color-brand)]"
                              >
                                {holder.displayName}
                              </RouteLink>
                              <span className="ml-2 text-[var(--color-fg-muted)]">
                                {t('role.detail.serviceAccountHolder')}
                              </span>
                            </>
                          ) : (
                            <>
                              <RouteLink
                                to="user.detail"
                                params={{ userId: holder.id }}
                                className="text-[var(--color-brand)]"
                              >
                                {holder.displayName}
                              </RouteLink>
                              <span className="ml-2 text-[var(--color-fg-muted)]">
                                {holder.email}
                              </span>
                            </>
                          )}
                        </li>
                      ))
                    ) : (
                      <li className="text-[var(--color-fg-muted)]">{t('common.none')}</li>
                    )}
                  </ul>
                  {pagination.total > HOLDER_PAGE_SIZE && (
                    <Pagination
                      className="mt-2"
                      offset={holderOffset}
                      limit={HOLDER_PAGE_SIZE}
                      pageSizeOptions={[HOLDER_PAGE_SIZE]}
                      total={pagination.total}
                      onChange={(next) => setHolderOffset(next.offset)}
                      data-testid="role-holder-users-pagination"
                    />
                  )}
                </>
              )}
            </QuerySection>
          </div>
        </>
      )}
      {canViewGroups && (
        <>
          <h4 className="mt-3 mb-0 text-xs font-medium text-[var(--color-fg-muted)]">
            {t('role.detail.groupHolders')}
          </h4>
          <div className="mt-1">
            <QuerySection query={groups} data-testid="role-holder-groups-error">
              {({ items, pagination }) => (
                <>
                  <ul
                    className="flex list-none flex-col gap-1 p-0 text-sm"
                    data-testid="role-holder-groups"
                  >
                    {items.length ? (
                      items.map((group) => (
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
                  {pagination.total > GROUP_PAGE_SIZE && (
                    <Pagination
                      className="mt-2"
                      offset={groupOffset}
                      limit={GROUP_PAGE_SIZE}
                      pageSizeOptions={[GROUP_PAGE_SIZE]}
                      total={pagination.total}
                      onChange={(next) => setGroupOffset(next.offset)}
                      data-testid="role-holder-groups-pagination"
                    />
                  )}
                </>
              )}
            </QuerySection>
          </div>
        </>
      )}
    </section>
  );
}
