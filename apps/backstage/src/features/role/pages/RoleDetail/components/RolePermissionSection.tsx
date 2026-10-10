import { Chip } from '@b2b-system/ui/Chip';
import { QuerySection } from '@b2b-system/web-core/components';
import type { QuerySectionState } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { RolePermissions } from '@/shared/api-sdk';

interface RolePermissionSectionProps {
  /** super-admin 不列權限，直接顯示「全部權限」 */
  isSuperAdmin: boolean;
  /**
   * 能不能看已授予的權限：`role:read` ＋ `permission:read`（與 `GET /roles/:id/permissions` 一致）。
   * 不能看時說明原因，不顯示「無」——那會讓人以為角色沒有任何權限
   */
  canView: boolean;
  query: QuerySectionState<RolePermissions>;
}

export function RolePermissionSection({
  isSuperAdmin,
  canView,
  query,
}: RolePermissionSectionProps) {
  const { t } = useTranslation();

  return (
    <section>
      <h3 className="m-0 text-sm font-semibold">{t('role.detail.permissions')}</h3>
      <div className="mt-2">
        {isSuperAdmin ? (
          <div className="flex flex-wrap gap-1" data-testid="role-permission-chips">
            <Chip tone="brand">{t('role.detail.allPermissions')}</Chip>
          </div>
        ) : !canView ? (
          <span
            className="text-sm text-[var(--color-fg-muted)]"
            data-testid="role-permission-hidden"
          >
            {t('role.detail.permissionsRequireCatalog')}
          </span>
        ) : (
          <QuerySection query={query} data-testid="role-permission-error">
            {({ permissions }) => (
              <div className="flex flex-wrap gap-1" data-testid="role-permission-chips">
                {permissions.length ? (
                  permissions.map((item) => (
                    <Chip key={item.key} tone="neutral">
                      {t(item.nameI18nKey)}
                    </Chip>
                  ))
                ) : (
                  <span className="text-sm text-[var(--color-fg-muted)]">{t('common.none')}</span>
                )}
              </div>
            )}
          </QuerySection>
        )}
      </div>
    </section>
  );
}
