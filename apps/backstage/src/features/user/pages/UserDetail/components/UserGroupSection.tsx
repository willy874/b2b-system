import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { RouteLink } from '@b2b-system/web-core/route-link';
import { useQuery } from '@tanstack/react-query';

import { getGroupListQueryOptions } from '@/apis/group/get-group-list/query';

/** 一個人所在的群組通常很少；超過就只列前面這些。 */
const USER_GROUP_LIMIT = 100;

interface UserGroupSectionProps {
  userId: string;
}

/**
 * 使用者所在的群組（docs/architecture/iam/01-model.md §9 G4）：直接所屬的在前，經由巢狀群組所屬的標上說明。
 * 群組持有的角色也會給這位使用者，所以和「角色」並列；成員的增減在群組的詳情裡做。
 */
export function UserGroupSection({ userId }: UserGroupSectionProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
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
        ) : groups.isError ? (
          // 查詢失敗：顯示原因與重試，不顯示「無」（看起來像這個人不在任何群組）
          <p
            role="alert"
            className="m-0 flex items-center gap-2 text-sm text-[var(--color-danger-text)]"
            data-testid="user-group-error"
          >
            {toMessage(groups.error)}
            <Button size="sm" onClick={() => void groups.refetch()} data-testid="user-group-retry">
              {t('common.retry')}
            </Button>
          </p>
        ) : (
          <span className="text-sm text-[var(--color-fg-muted)]">
            {groups.isPending ? '…' : t('common.none')}
          </span>
        )}
      </div>
    </section>
  );
}
