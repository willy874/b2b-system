import { useQuery } from '@tanstack/react-query';

import { getGroupListQueryOptions } from '@/apis/group/get-group-list/query';
import { Chip } from '@/components/Chip';
import { Tooltip } from '@/components/Tooltip';
import { useTranslation } from '@/core/locales';
import { RouteLink } from '@/core/route-link';

/** 一個人所在的群組通常很少；超過就只列前面這些。 */
const USER_GROUP_LIMIT = 100;

interface UserGroupSectionProps {
  userId: string;
}

/**
 * 使用者所在的群組（docs/rbac/01-domain-model.md §9 G4）：直接所屬的在前，經由巢狀群組所屬的標上說明。
 * 群組持有的角色也會給這位使用者，所以和「角色」並列；成員的增減在群組的詳情裡做。
 */
export function UserGroupSection({ userId }: UserGroupSectionProps) {
  const { t } = useTranslation();
  const groups = useQuery(
    getGroupListQueryOptions({
      params: {
        offset: 0,
        limit: USER_GROUP_LIMIT,
        userId,
        sort: [{ sort: 'name', order: 'asc' }],
      },
    }),
  );
  const items = (groups.data?.items ?? []).toSorted(
    (a, b) => Number(a.membership === 'nested') - Number(b.membership === 'nested'),
  );

  return (
    <section data-testid="user-group-section">
      <h3 className="m-0 text-sm font-semibold">{t('user.detail.groups')}</h3>
      <p className="mt-1 text-xs text-[var(--color-fg-muted)]">{t('user.detail.groupsHint')}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {items.length ? (
          items.map((group) => {
            const link = (
              <RouteLink
                to="group.detail"
                params={{ groupId: group.id }}
                data-testid="user-group"
                data-value={group.id}
              >
                <Chip tone={group.membership === 'nested' ? 'neutral' : 'brand'}>{group.name}</Chip>
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
          <span className="text-sm text-[var(--color-fg-muted)]">
            {groups.isPending ? '…' : t('common.none')}
          </span>
        )}
      </div>
    </section>
  );
}
