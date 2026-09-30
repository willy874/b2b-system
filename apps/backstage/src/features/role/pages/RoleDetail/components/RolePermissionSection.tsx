import { Chip } from '@/components/Chip';
import { useTranslation } from '@/core/locales';
import type { RolePermissions } from '@/shared/api-sdk';

interface RolePermissionSectionProps {
  /** super-admin 不列權限，直接顯示「全部權限」 */
  isSuperAdmin: boolean;
  permissions: RolePermissions['permissions'] | undefined;
}

export function RolePermissionSection({ isSuperAdmin, permissions }: RolePermissionSectionProps) {
  const { t } = useTranslation();

  return (
    <section>
      <h3 className="m-0 text-sm font-semibold">{t('role.detail.permissions')}</h3>
      <div className="mt-2 flex flex-wrap gap-1" data-testid="role-permission-chips">
        {isSuperAdmin ? (
          <Chip tone="brand">{t('role.detail.allPermissions')}</Chip>
        ) : permissions?.length ? (
          permissions.map((item) => (
            <Chip key={item.key} tone="neutral">
              {t(item.nameI18nKey)}
            </Chip>
          ))
        ) : (
          <span className="text-sm text-[var(--color-fg-muted)]">{t('common.none')}</span>
        )}
      </div>
    </section>
  );
}
