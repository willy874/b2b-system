import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useUnsavedChangesGuard } from '@b2b-system/web-core/router';
import { useState } from 'react';

import type { Role, RoleSummary } from '@/shared/api-sdk';

import { ServiceAccountRoleSelect } from '../../../components/ServiceAccountRoleSelect';
import { useServiceAccountRolesReplaceMutation } from '../../../hooks/useServiceAccountMutations';

interface ServiceAccountRoleSectionProps {
  serviceAccountId: string;
  roles: RoleSummary[];
  /** 可選擇的角色；不能改角色時是 undefined，顯示唯讀的 Chip。 */
  roleOptions: Role[] | undefined;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a);
  return a.length === b.length && b.every((id) => set.has(id));
}

/**
 * 持有的角色：決定它的 token 能做什麼（token 的 scopes 只能再縮小）。整批取代，帶上編輯開始時的角色
 * （`expectedRoleIds`），別人剛改過時後端回 409。
 */
export function ServiceAccountRoleSection({
  serviceAccountId,
  roles,
  roleOptions,
}: ServiceAccountRoleSectionProps) {
  const { t } = useTranslation();
  const current = roles.map((role) => role.id);
  const [draft, setDraft] = useState<string[]>();
  const selected = draft ?? current;
  const isDirty = draft !== undefined && !sameIds(draft, current);
  const replaceRoles = useServiceAccountRolesReplaceMutation();
  useUnsavedChangesGuard(isDirty);

  return (
    <section>
      <h3 className="m-0 text-sm font-semibold">{t('serviceAccount.detail.roles')}</h3>
      <p className="mt-1 text-xs text-[var(--color-fg-muted)]">{t('serviceAccount.role.hint')}</p>
      {roleOptions ? (
        <div className="mt-2 flex flex-col gap-2" data-testid="service-account-role-picker">
          <ServiceAccountRoleSelect
            roles={roleOptions}
            value={selected}
            onValueChange={setDraft}
            aria-label={t('serviceAccount.detail.roles')}
            data-testid="service-account-role-select"
          />
          <div className="flex justify-end gap-2">
            {isDirty && (
              <Button size="sm" onClick={() => setDraft(undefined)}>
                {t('common.cancel')}
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              disabled={!isDirty}
              loading={replaceRoles.isPending}
              // 失敗由 mutation 的 onError 顯示（衝突時已重抓），選擇清掉讓使用者以最新的角色重選
              onClick={() =>
                void replaceRoles
                  .mutateAsync({
                    params: {
                      serviceAccountId,
                      body: { roleIds: selected, expectedRoleIds: current },
                    },
                  })
                  .catch(() => undefined)
                  .finally(() => setDraft(undefined))
              }
              data-testid="service-account-save-roles-button"
            >
              {t('serviceAccount.role.save')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1">
          {roles.length === 0 && (
            <span className="text-sm text-[var(--color-fg-muted)]">{t('common.none')}</span>
          )}
          {roles.map((role) => (
            <Chip key={role.id} tone={role.isSystem ? 'brand' : 'neutral'}>
              {role.name}
            </Chip>
          ))}
        </div>
      )}
    </section>
  );
}
