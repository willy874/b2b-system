import { Button } from '@/components/Button';
import { Checkbox } from '@/components/Checkbox';
import { Chip } from '@/components/Chip';
import { useTranslation } from '@/core/locales';
import { useUnsavedChangesGuard } from '@/core/router';
import type { Role, User } from '@/shared/api-sdk';

import { useAssignUserRolesMutation } from '../../../hooks/useUserMutations';
import { useUserRoleSelection } from '../useUserRoleSelection';

interface UserRoleSectionProps {
  user: User;
  /** 可指派的角色選項（需要 role:read） */
  roleOptions: Role[] | undefined;
  canAssignRole: boolean;
  /** 不能改自己的角色 */
  isSelf: boolean;
}

/** 使用者持有的角色：有權限時是勾選清單，否則是唯讀的 Chip。 */
export function UserRoleSection({
  user,
  roleOptions,
  canAssignRole,
  isSelf,
}: UserRoleSectionProps) {
  const { t } = useTranslation();
  const assignRoles = useAssignUserRolesMutation(user);
  const { selectedRoleIds, toggleRole, isDirty, isStale, expectedRoleIds, discardDraft } =
    useUserRoleSelection(user.roles);
  // 勾了角色還沒儲存就關閉詳情：先確認（EDGE-26）
  useUnsavedChangesGuard(isDirty);

  return (
    <section>
      <h3 className="m-0 text-sm font-semibold">{t('user.detail.roles')}</h3>
      {canAssignRole && !isSelf ? (
        <div className="mt-2 flex flex-col gap-2" data-testid="user-role-picker">
          {roleOptions?.map((role) => (
            <Checkbox
              key={role.id}
              checked={selectedRoleIds.has(role.id)}
              onCheckedChange={(checked) => toggleRole(role.id, checked)}
              label={role.name}
              description={role.slug}
              data-testid="user-detail-role"
              data-value={role.slug}
            />
          ))}
          {isStale && (
            <div
              className="flex items-center justify-between gap-2 text-xs text-[var(--color-fg-muted)]"
              data-testid="user-role-stale"
            >
              <span>{t('user.assignRole.stale')}</span>
              <Button size="sm" onClick={discardDraft} data-testid="user-role-discard-button">
                {t('user.assignRole.discard')}
              </Button>
            </div>
          )}
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="primary"
              disabled={!isDirty}
              loading={assignRoles.isPending}
              // 失敗由 mutation 的 onError 顯示，勾選保留
              onClick={() =>
                void assignRoles
                  .mutateAsync({
                    params: {
                      userId: user.id,
                      body: { roleIds: [...selectedRoleIds], expectedRoleIds },
                    },
                  })
                  .then(discardDraft)
                  .catch(() => undefined)
              }
              data-testid="user-assign-roles-button"
            >
              {t('user.assignRole.action')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1">
          {user.roles.length ? (
            user.roles.map((role) => (
              <Chip key={role.id} tone={role.isSystem ? 'brand' : 'neutral'}>
                {role.name}
              </Chip>
            ))
          ) : (
            <span className="text-sm text-[var(--color-fg-muted)]">{t('common.none')}</span>
          )}
        </div>
      )}
      {isSelf && (
        <p className="mt-2 text-xs text-[var(--color-fg-muted)]">{t('user.detail.selfHint')}</p>
      )}
    </section>
  );
}
