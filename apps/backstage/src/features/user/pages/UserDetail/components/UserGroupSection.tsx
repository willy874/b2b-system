import { Chip } from '@b2b-system/ui/Chip';
import { Pagination } from '@b2b-system/ui/Pagination';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { QuerySection, useOffsetClamp } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { RouteLink } from '@b2b-system/web-core/route-link';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getGroupListQueryOptions } from '@/apis/group/get-group-list/query';

/** 一頁幾個群組；一個人所在的群組通常很少，超過時分頁（只列前面幾個會讓人以為他只在這些群組裡）。 */
const USER_GROUP_PAGE_SIZE = 50;

interface UserGroupSectionProps {
  userId: string;
}

/**
 * 使用者所在的群組（docs/architecture/iam/01-model.md §9 G4）：同一頁裡直接所屬的在前，經由巢狀群組所屬的標上說明。
 * 群組持有的角色也會給這位使用者，所以和「角色」並列；成員的增減在群組的詳情裡做。
 */
export function UserGroupSection({ userId }: UserGroupSectionProps) {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(0);
  const groups = useQuery(
    getGroupListQueryOptions({
      params: {
        offset,
        limit: USER_GROUP_PAGE_SIZE,
        userId,
        sort: [{ sort: 'name', order: 'asc' }],
      },
    }),
  );
  useOffsetClamp(groups.data?.pagination.total, offset, USER_GROUP_PAGE_SIZE, setOffset);

  return (
    <section data-testid="user-group-section">
      <h3 className="m-0 text-sm font-semibold">{t('user.detail.groups')}</h3>
      <p className="mt-1 text-xs text-[var(--color-fg-muted)]">{t('user.detail.groupsHint')}</p>
      <div className="mt-2">
        {/* 查詢失敗：顯示原因與重試，不顯示「無」（看起來像這個人不在任何群組） */}
        <QuerySection query={groups} data-testid="user-group-error">
          {({ items, pagination }) => (
            <>
              <div className="flex flex-wrap gap-1">
                {items.length ? (
                  items
                    .toSorted(
                      (a, b) =>
                        Number(a.membership === 'nested') - Number(b.membership === 'nested'),
                    )
                    .map((group) => {
                      const link = (
                        <RouteLink
                          to="group.detail"
                          params={{ groupId: group.id }}
                          data-testid="user-group"
                          data-value={group.id}
                        >
                          <Chip tone={group.membership === 'nested' ? 'neutral' : 'brand'}>
                            {group.name}
                          </Chip>
                        </RouteLink>
                      );
                      return group.membership === 'nested' ? (
                        <Tooltip key={group.id} content={t('user.detail.nestedGroup')}>
                          {link}
                        </Tooltip>
                      ) : (
                        <span key={group.id}>{link}</span>
                      );
                    })
                ) : (
                  <span className="text-sm text-[var(--color-fg-muted)]">{t('common.none')}</span>
                )}
              </div>
              {pagination.total > USER_GROUP_PAGE_SIZE && (
                <Pagination
                  className="mt-2"
                  offset={offset}
                  limit={USER_GROUP_PAGE_SIZE}
                  pageSizeOptions={[USER_GROUP_PAGE_SIZE]}
                  total={pagination.total}
                  onChange={(next) => setOffset(next.offset)}
                  data-testid="user-group-pagination"
                />
              )}
            </>
          )}
        </QuerySection>
      </div>
    </section>
  );
}
