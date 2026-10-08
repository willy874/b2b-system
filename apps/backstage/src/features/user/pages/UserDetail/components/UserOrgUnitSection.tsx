import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { RouteLink } from '@b2b-system/web-core/route-link';
import { useQuery } from '@tanstack/react-query';

import { getUserOrgUnitsQueryOptions } from '@/apis/org-unit/get-user-org-units/query';

interface UserOrgUnitSectionProps {
  userId: string;
}

/**
 * 使用者所屬的部門（docs/architecture/backend/23-organization.md §8）：主要部門在前（後端已排序），
 * 顯示上層路徑、主管與職稱。成員資格的增減在組織頁做；部門不帶權限，所以只是資訊。
 */
export function UserOrgUnitSection({ userId }: UserOrgUnitSectionProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const units = useQuery(getUserOrgUnitsQueryOptions(userId));
  const items = units.data?.items ?? [];

  return (
    <section data-testid="user-org-unit-section">
      <h3 className="m-0 text-sm font-semibold">{t('user.detail.orgUnits')}</h3>
      {items.length ? (
        <ul className="mt-2 flex list-none flex-col gap-1 p-0 text-sm">
          {items.map((unit) => (
            <li
              key={unit.unitId}
              className="flex flex-wrap items-center gap-2"
              data-testid="user-org-unit"
              data-value={unit.unitId}
            >
              {unit.path.length > 0 && (
                <span className="text-[var(--color-fg-muted)]">
                  {unit.path.map((item) => item.name).join(' / ')} /
                </span>
              )}
              <RouteLink
                to="organization.unit"
                params={{ unitId: unit.unitId }}
                className="text-[var(--color-brand)]"
              >
                {unit.name}
              </RouteLink>
              {unit.isPrimary && <Chip tone="brand">{t('user.orgUnit.primary')}</Chip>}
              {unit.isManager && <Chip tone="neutral">{t('user.orgUnit.manager')}</Chip>}
              {unit.title && <span className="text-[var(--color-fg-muted)]">{unit.title}</span>}
            </li>
          ))}
        </ul>
      ) : units.isError ? (
        // 查詢失敗：顯示原因與重試，不顯示「無」（看起來像這個人不屬於任何部門）
        <p
          role="alert"
          className="m-0 mt-2 flex items-center gap-2 text-sm text-[var(--color-danger-text)]"
          data-testid="user-org-unit-error"
        >
          {toMessage(units.error)}
          <Button size="sm" onClick={() => void units.refetch()}>
            {t('common.retry')}
          </Button>
        </p>
      ) : (
        <p className="m-0 mt-2 text-sm text-[var(--color-fg-muted)]">
          {units.isPending ? '…' : t('common.none')}
        </p>
      )}
    </section>
  );
}
