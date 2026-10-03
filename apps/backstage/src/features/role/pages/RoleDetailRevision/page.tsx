import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { invalidateResources, Resource } from '@/apis/resources';
import { getRoleDetailQueryOptions } from '@/apis/role/get-role-detail/query';
import { Button } from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import { Dialog } from '@/components/Dialog';
import { Empty } from '@/components/Empty';
import { JsonDiff } from '@/components/JsonDiff';
import type { JsonDiffLabels } from '@/components/JsonDiff';
import { Skeleton } from '@/components/Skeleton';
import { Tabs } from '@/components/Tabs';
import { QueryError, VersionConflictAlert } from '@/core/components';
import { isVersionConflict } from '@/core/errors';
import { useTranslation } from '@/core/locales';

import { useRoleRevertRevisionMutation } from '../../hooks/useRoleMutations';
import { useRolePermission } from '../../hooks/useRolePermission';
import { useRoleRevisionHistory } from '../../hooks/useRoleRevisionHistory';
import type { RoleRevisionCompareMode } from '../../hooks/useRoleRevisionHistory';
import { RoleDetailRevisionRoute, RoleDetailRoute, RoleListRoute } from '../../routes';
import { permissionKeysDiffer, toRoleRevisionRowVM } from './adapter';
import { RoleRevisionList } from './components/RoleRevisionList';

/** 版本紀錄（docs/architecture/backend/14-revisions.md §9 R5，docs/architecture/frontend/14-revisions.md）：列表、與目前或前一版的差異、還原到這一版。 */
export default function RoleDetailRevisionPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { roleId } = RoleDetailRevisionRoute.useParams();
  const search = RoleListRoute.useSearch();
  const permission = useRolePermission();
  const role = useQuery(getRoleDetailQueryOptions(roleId));
  const history = useRoleRevisionHistory(roleId);
  const revert = useRoleRevertRevisionMutation();
  const [conflict, setConflict] = useState<unknown>();
  const [reloading, setReloading] = useState(false);

  const close = () => void navigate({ to: RoleDetailRoute.to, params: { roleId }, search });
  const diffLabels: JsonDiffLabels = {
    expandUnchanged: (count) => t('role.revision.expandUnchanged', { count }),
    empty: t('role.revision.noChanges'),
  };

  const selected = history.selected.data;
  const changesKeys = permissionKeysDiffer(selected?.snapshot, history.currentSnapshot);
  // 系統角色的名稱與權限在畫面上本來就不能改（RoleDetail 的 canEdit），還原也不提供
  const canRevert = permission.canUpdate && role.data !== undefined && !role.data.isSystem;
  // 選中的一版還在載入時不顯示理由（按鈕仍停用）
  const revertBlockedReason = !selected
    ? undefined
    : !selected.snapshot
      ? t('role.revision.revert.unavailable')
      : history.isLatest
        ? t('role.revision.revert.isCurrent')
        : changesKeys && !permission.canGrantPermission
          ? t('role.revision.revert.needGrantPermission')
          : undefined;

  const startRevert = (version: number) => {
    // 樂觀鎖：帶「確認時」看到的角色版本；確認期間被別人改過就回 409，不默默蓋掉。
    // 角色還沒載入時不會出現還原按鈕（canRevert）
    if (!role.data) return;
    const baseVersion = role.data.version;
    void confirm({
      title: t('role.revision.revert.title', { version }),
      description: t('role.revision.revert.confirm', { version }),
      confirmLabel: t('role.revision.revert.action'),
      tone: 'primary',
      'data-testid': 'role-revision-revert-confirm',
      onConfirm: async () => {
        setConflict(undefined);
        try {
          await revert.mutateAsync({ params: { roleId, version, body: { version: baseVersion } } });
        } catch (error) {
          // 衝突：關閉確認框，在頁面上說明並提供重新載入；其他錯誤由 mutation 提示，確認框留著讓使用者重試或取消
          if (isVersionConflict(error)) {
            setConflict(error);
            return;
          }
          throw error;
        }
      },
    });
  };

  const reload = async () => {
    setReloading(true);
    try {
      invalidateResources([{ resource: Resource.ROLE, kind: 'update', id: roleId }]);
      await queryClient.refetchQueries({ queryKey: getRoleDetailQueryOptions(roleId).queryKey });
      setConflict(undefined);
    } finally {
      setReloading(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={t('role.revision.title')}
      description={t('role.revision.description')}
      size="xl"
      data-testid="role-revision-dialog"
      footer={
        <Button variant="primary" onClick={close}>
          {t('common.close')}
        </Button>
      }
    >
      {history.list.isPending && <Skeleton height={240} />}
      {history.list.isError && (
        <QueryError error={history.list.error} onRetry={() => void history.list.refetch()} />
      )}
      {history.list.isSuccess && history.items.length === 0 && (
        <Empty title={t('role.revision.empty')} data-testid="role-revision-empty" />
      )}
      {history.items.length > 0 && (
        <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
          <RoleRevisionList
            rows={history.items.map(toRoleRevisionRowVM)}
            selectedVersion={history.selectedVersion}
            latestVersion={history.latestVersion}
            onSelect={history.select}
            offset={history.offset}
            limit={history.limit}
            total={history.total}
            onPageChange={history.changePage}
          />
          <section className="flex min-w-0 flex-col gap-3" data-testid="role-revision-detail">
            {conflict !== undefined && (
              <VersionConflictAlert
                error={conflict}
                onReload={() => void reload()}
                reloading={reloading}
              />
            )}
            <Tabs
              moreLabel={t('common.more')}
              value={history.compare}
              onValueChange={(value) => history.setCompare(value as RoleRevisionCompareMode)}
              tabs={[
                { value: 'current', label: t('role.revision.compare.current') },
                { value: 'previous', label: t('role.revision.compare.previous') },
              ]}
              data-testid="role-revision-compare"
            />
            {history.isBaseMissing && (
              <p className="m-0 text-xs text-[var(--color-fg-muted)]">
                {t('role.revision.previousMissing')}
              </p>
            )}
            {selected && !selected.snapshot ? (
              <p className="m-0 text-sm text-[var(--color-warning-text)]">
                {t('role.revision.tooLargeDetail')}
              </p>
            ) : (
              <JsonDiff
                before={history.before}
                after={history.after}
                labels={diffLabels}
                aria-label={t('role.revision.diff')}
                data-testid="role-revision-diff"
              />
            )}
            {canRevert && history.selectedVersion !== undefined && (
              <div className="flex items-center justify-end gap-3">
                {revertBlockedReason && (
                  <p className="m-0 text-xs text-[var(--color-fg-muted)]">{revertBlockedReason}</p>
                )}
                <Button
                  variant="primary"
                  disabled={!selected || revertBlockedReason !== undefined}
                  loading={revert.isPending}
                  onClick={() => history.selectedVersion && startRevert(history.selectedVersion)}
                  data-testid="role-revision-revert"
                >
                  {t('role.revision.revert.action')}
                </Button>
              </div>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}
