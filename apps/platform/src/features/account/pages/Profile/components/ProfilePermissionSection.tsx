import { Chip } from '@/components/Chip';
import { useTranslation } from '@/core/locales';
import type { PermissionKey } from '@/core/permission';

import { PLATFORM_PERMISSION_LABEL_KEY } from '../../../constants';

interface ProfilePermissionSectionProps {
  permissions: readonly PermissionKey[];
}

/**
 * 自己的權限：平台的角色固定三種、每人一個（docs/rbac/02-permission-catalog.md §8.2），
 * 權限只從角色來，所以不像 backstage 列出來源，只列出角色帶來的權限。
 */
export function ProfilePermissionSection({ permissions }: ProfilePermissionSectionProps) {
  const { t } = useTranslation();

  return (
    <section className="flex flex-col gap-2" data-testid="profile-permissions">
      <h2 className="m-0 text-base font-medium">{t('account.profile.effective')}</h2>
      <p className="m-0 text-sm text-[var(--color-fg-muted)]">
        {t('account.profile.effectiveHint')}
      </p>
      <div className="flex flex-wrap gap-1">
        {permissions.map((key) => (
          <Chip key={key} data-testid="profile-permission" data-value={key}>
            {t(PLATFORM_PERMISSION_LABEL_KEY[key])}
          </Chip>
        ))}
      </div>
    </section>
  );
}
