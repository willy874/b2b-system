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

interface RoleDraft {
  /** 開始編輯時伺服器上的角色：送出時帶給後端比對（`expectedRoleIds`）。 */
  base: string[];
  selected: string[];
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a);
  return a.length === b.length && b.every((id) => set.has(id));
}

/**
 * 持有的角色：決定它的 token 能做什麼（token 的 scopes 只能再縮小）。整批取代，帶上第一次修改時的角色
 * （`expectedRoleIds`，草稿的 `base`）：編輯途中推播讓資料重抓也不換成最新的，別人剛改過時後端回 409，
 * 不會默默蓋掉別人的變更（docs/architecture/backend/03-api-conventions.md §11）。
 * 伺服器的角色與 `base` 不同時提示「資料已被他人修改」，選擇保留，由使用者決定要不要改用最新的角色。
 */
export function ServiceAccountRoleSection({
  serviceAccountId,
  roles,
  roleOptions,
}: ServiceAccountRoleSectionProps) {
  const { t } = useTranslation();
  const current = roles.map((role) => role.id);
  const [draft, setDraft] = useState<RoleDraft>();
  const selected = draft?.selected ?? current;
  const isDirty = !sameIds(selected, current);
  const isStale = draft !== undefined && !sameIds(draft.base, current);
  const select = (roleIds: string[]) =>
    setDraft((previous) => ({ base: previous?.base ?? current, selected: roleIds }));
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
            onValueChange={select}
            aria-label={t('serviceAccount.detail.roles')}
            data-testid="service-account-role-select"
          />
          {isStale && (
            <div
              className="flex items-center justify-between gap-2 text-xs text-[var(--color-fg-muted)]"
              data-testid="service-account-role-stale"
            >
              <span>{t('serviceAccount.role.stale')}</span>
              <Button
                size="sm"
                onClick={() => setDraft(undefined)}
                data-testid="service-account-role-discard-button"
              >
                {t('serviceAccount.role.discard')}
              </Button>
            </div>
          )}
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
              // 失敗由 mutation 的 onError 顯示（並重抓）；選擇保留，衝突時重抓後出現過期提示
              onClick={() =>
                void replaceRoles
                  .mutateAsync({
                    params: {
                      serviceAccountId,
                      body: { roleIds: selected, expectedRoleIds: draft?.base ?? current },
                    },
                  })
                  .then(() => setDraft(undefined))
                  .catch(() => undefined)
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
