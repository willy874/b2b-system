import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { Select } from '@b2b-system/ui/Select';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useUnsavedChangesGuard } from '@b2b-system/web-core/router';

import type { GroupRole, Role } from '@/shared/api-sdk';

import { useGroupRolesUpdateMutation } from '../../../hooks/useGroupMutations';
import { useGroupRoleDraft } from '../../../hooks/useGroupRoleDraft';

/** super-admin 一律直接指派給使用者，不出現在群組的選項裡（docs/rbac/01-domain-model.md §9.3 D12）。 */
const SUPER_ADMIN_SLUG = 'super-admin';

interface GroupRoleSectionProps {
  groupId: string;
  roles: GroupRole[] | undefined;
  /** 可選擇的角色（需要 role:read）；沒有 `group:assignRole` 時是 undefined，顯示唯讀的 Chip */
  roleOptions: Role[] | undefined;
}

/** 群組持有的角色：成員都取得這些角色（受反提權限制，後端再檢查）。 */
export function GroupRoleSection({ groupId, roles, roleOptions }: GroupRoleSectionProps) {
  const { t } = useTranslation();
  const current = (roles ?? []).map((role) => role.id);
  const { selected, select, diff, isDirty, discard } = useGroupRoleDraft(current);
  const updateRoles = useGroupRolesUpdateMutation();
  useUnsavedChangesGuard(isDirty);

  return (
    <section>
      <h3 className="m-0 text-sm font-semibold">{t('group.detail.roles')}</h3>
      <p className="mt-1 text-xs text-[var(--color-fg-muted)]">{t('group.detail.rolesHint')}</p>
      {roleOptions ? (
        <div className="mt-2 flex flex-col gap-2" data-testid="group-role-picker">
          <Select
            multiple
            searchable
            valueOrder="options"
            value={selected}
            onValueChange={select}
            options={roleOptions
              .filter((role) => role.slug !== SUPER_ADMIN_SLUG)
              .map((role) => ({
                value: role.id,
                label: role.name,
                textValue: `${role.name} ${role.slug}`,
                description: role.slug,
              }))}
            itemSize={48}
            placeholder={t('group.role.placeholder')}
            searchPlaceholder={t('common.search')}
            aria-label={t('group.detail.roles')}
            data-testid="group-role-select"
          />
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
              // 失敗由 mutation 的 onError 顯示，選擇保留
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
