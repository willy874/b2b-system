import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { QueryError } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useUnsavedChangesGuard } from '@b2b-system/web-core/router';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { getRolePermissionsQueryOptions } from '@/apis/role/get-role-permissions/query';

import { PermissionSkillTree } from '../../components';
import { useGrantRolePermissionsMutation } from '../../hooks/useRoleMutations';
import { useRolePermission } from '../../hooks/useRolePermission';
import { RoleDetailPermissionRoute, RoleDetailRoute, RoleListRoute } from '../../routes';

export default function RoleDetailPermissionPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { roleId } = RoleDetailPermissionRoute.useParams();
  const search = RoleListRoute.useSearch();
  const permission = useRolePermission();
  const current = useQuery(getRolePermissionsQueryOptions(roleId));
  const grant = useGrantRolePermissionsMutation();

  const initial = useMemo(
    () => new Set<string>((current.data?.permissions ?? []).map((item) => String(item.key))),
    [current.data],
  );
  // 資料還沒回來之前沒有草稿；使用者勾選後才有。不用 effect 同步，避免串連渲染。
  const [draft, setDraft] = useState<Set<string>>();
  const selected = draft ?? initial;
  const setSelected = (updater: (previous: Set<string>) => Set<string>) =>
    setDraft((previous) => updater(previous ?? initial));

  const close = (options?: { ignoreBlocker?: boolean }) =>
    void navigate({ to: RoleDetailRoute.to, params: { roleId }, search, ...options });

  const add = [...selected].filter((key) => !initial.has(key));
  const remove = [...initial].filter((key) => !selected.has(key));
  const dirty = add.length > 0 || remove.length > 0;
  useUnsavedChangesGuard(dirty);

  // 既有權限回來之前不能勾選：以空集合為基準的草稿，儲存時會把角色原有的權限全部移除
  const loaded = current.isSuccess;

  const save = async () => {
    try {
      await grant.mutateAsync({
        params: { roleId, body: { add: add as never, remove: remove as never } },
      });
    } catch {
      // 錯誤由 mutation 的 onError 顯示；對話框與草稿保留，讓使用者修正後重送
      return;
    }
    close({ ignoreBlocker: true });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={t('role.permission.title')}
      description={t('role.permission.description')}
      size="xl"
      data-testid="role-permission-dialog"
      footer={
        <>
          {dirty && (
            <p
              className="m-0 me-auto text-sm text-[var(--color-fg-muted)]"
              aria-live="polite"
              data-testid="role-permission-summary"
            >
              {t('role.permission.summary', { add: add.length, remove: remove.length })}
            </p>
          )}
          <Button onClick={() => close()} data-testid="role-permission-cancel">
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!loaded || !dirty || !permission.canGrantPermission}
            loading={grant.isPending}
            onClick={() => void save()}
            data-testid="role-permission-save"
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      {current.isPending && <Skeleton height={240} data-testid="role-permission-loading" />}
      {current.isError && (
        <QueryError error={current.error} onRetry={() => void current.refetch()} />
      )}
      {loaded && (
        <PermissionSkillTree
          explicit={selected}
          onChange={(next) => setSelected(() => next)}
          readOnly={!permission.canGrantPermission}
          isSuperAdmin={current.data?.isSuperAdmin}
          data-testid="role-permission-picker"
        />
      )}
    </Dialog>
  );
}
