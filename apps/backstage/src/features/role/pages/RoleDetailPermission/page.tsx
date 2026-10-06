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
import type { PermissionKey } from '@/core/permission';

import { PermissionSkillTree } from '../../components';
import { useGrantRolePermissionsMutation } from '../../hooks/useRoleMutations';
import { useRolePermission } from '../../hooks/useRolePermission';
import { RoleDetailPermissionRoute, RoleDetailRoute, RoleListRoute } from '../../routes';

interface PermissionDraft {
  /** 開始編輯時伺服器上的權限：送出的增減對它計算。 */
  base: ReadonlySet<PermissionKey>;
  selected: Set<PermissionKey>;
}

function diffKeys(base: ReadonlySet<PermissionKey>, selected: ReadonlySet<PermissionKey>) {
  return {
    add: [...selected].filter((key) => !base.has(key)),
    remove: [...base].filter((key) => !selected.has(key)),
  };
}

function sameKeys(left: ReadonlySet<PermissionKey>, right: ReadonlySet<PermissionKey>): boolean {
  return left.size === right.size && [...left].every((key) => right.has(key));
}

export default function RoleDetailPermissionPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { roleId } = RoleDetailPermissionRoute.useParams();
  const search = RoleListRoute.useSearch();
  const permission = useRolePermission();
  const current = useQuery(getRolePermissionsQueryOptions(roleId));
  const grant = useGrantRolePermissionsMutation();

  const initial = useMemo(
    () => new Set<PermissionKey>((current.data?.permissions ?? []).map((item) => item.key)),
    [current.data],
  );
  // 資料還沒回來之前沒有草稿；使用者勾選後才有。不用 effect 同步，避免串連渲染。
  // 草稿記下第一次勾選時的權限（`base`）：之後推播或重新取得焦點讓資料重抓，差異仍對它計算，
  // 不會把別人剛拿掉的權限當成「新增」送回去（docs/architecture/backend/03-api-conventions.md §11）
  const [draft, setDraft] = useState<PermissionDraft>();
  const selected = draft?.selected ?? initial;
  const setSelected = (next: Set<PermissionKey>) =>
    setDraft((previous) => ({ base: previous?.base ?? initial, selected: next }));

  const close = (options?: { ignoreBlocker?: boolean }) =>
    void navigate({ to: RoleDetailRoute.to, params: { roleId }, search, ...options });

  const { add, remove } = diffKeys(draft?.base ?? initial, selected);
  const dirty = add.length > 0 || remove.length > 0;
  /** 草稿所依據的權限已經不是伺服器上最新的：別人在這段時間改過這個角色。 */
  const isStale = draft !== undefined && !sameKeys(draft.base, initial);
  useUnsavedChangesGuard(dirty);

  // 既有權限回來之前不能勾選：以空集合為基準的草稿，儲存時會把角色原有的權限全部移除
  const loaded = current.isSuccess;

  const save = async () => {
    try {
      await grant.mutateAsync({
        params: { roleId, body: { add, remove } },
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
      {isStale && (
        <div
          className="mb-3 flex items-center justify-between gap-2 text-xs text-[var(--color-fg-muted)]"
          data-testid="role-permission-stale"
        >
          <span>{t('role.permission.stale')}</span>
          <Button
            size="sm"
            onClick={() => setDraft(undefined)}
            data-testid="role-permission-discard"
          >
            {t('role.permission.discard')}
          </Button>
        </div>
      )}
      {loaded && (
        <PermissionSkillTree
          explicit={selected}
          onChange={setSelected}
          readOnly={!permission.canGrantPermission}
          isSuperAdmin={current.data?.isSuperAdmin}
          data-testid="role-permission-picker"
        />
      )}
    </Dialog>
  );
}
