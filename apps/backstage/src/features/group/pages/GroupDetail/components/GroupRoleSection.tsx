import { Button } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { Chip } from '@/components/Chip';
import { useTranslation } from '@/core/locales';
import { useUnsavedChangesGuard } from '@/core/router';
import type { GroupRole, Role } from '@/shared/api-sdk';

import { useGroupRolesUpdateMutation } from '../../../hooks/useGroupMutations';
import { useGroupRoleDraft } from '../../../hooks/useGroupRoleDraft';

/** super-admin 一律直接指派給使用者，不出現在群組的選項裡（ADR-0024 D12）。 */
const SUPER_ADMIN_SLUG = 'super-admin';

interface GroupRoleSectionProps {
  groupId: string;
  roles: GroupRole[] | undefined;
  /** 可勾選的角色（需要 role:read）；沒有 `group:assignRole` 時是 undefined，顯示唯讀的 Chip */
  roleOptions: Role[] | undefined;
}

/** 群組持有的角色：成員都取得這些角色（受反提權限制，後端再檢查）。 */
export function GroupRoleSection({ groupId, roles, roleOptions }: GroupRoleSectionProps) {
  const { t } = useTranslation();
  const current = (roles ?? []).map((role) => role.id);
  const { selected, toggle, diff, isDirty, discard } = useGroupRoleDraft(current);
  const updateRoles = useGroupRolesUpdateMutation();
  useUnsavedChangesGuard(isDirty);

  return (
    <section>
      <h3 className="m-0 text-sm font-semibold">{t('group.detail.roles')}</h3>
      <p className="mt-1 text-xs text-[var(--color-fg-muted)]">{t('group.detail.rolesHint')}</p>
      {roleOptions ? (
        <div className="mt-2 flex flex-col gap-2" data-testid="group-role-picker">
          {roleOptions
            .filter((role) => role.slug !== SUPER_ADMIN_SLUG)
            .map((role) => (
              <Checkbox
                key={role.id}
                checked={selected.has(role.id)}
                onCheckedChange={(checked) => toggle(role.id, checked)}
                label={role.name}
                description={role.slug}
                data-testid="group-detail-role"
                data-value={role.slug}
              />
            ))}
          <div className="flex justify-end gap-2">
            {isDirty && (
              <Button size="sm" onClick={discard}>
                {t('common.cancel')}
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              disabled={!isDirty}
              loading={updateRoles.isPending}
              // 失敗由 mutation 的 onError 顯示，勾選保留
              onClick={() =>
                void updateRoles
                  .mutateAsync({ params: { groupId, body: diff } })
                  .then(discard)
                  .catch(() => undefined)
              }
              data-testid="group-save-roles-button"
            >
              {t('group.role.save')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1">
          {roles?.length ? (
            roles.map((role) => (
              <Chip key={role.id} tone={role.isSystem ? 'brand' : 'neutral'}>
                {role.name}
              </Chip>
            ))
          ) : (
            <span className="text-sm text-[var(--color-fg-muted)]">{t('common.none')}</span>
          )}
        </div>
      )}
    </section>
  );
}
