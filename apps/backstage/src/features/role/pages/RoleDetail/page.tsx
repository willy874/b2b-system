import { Button, ButtonLink } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { QueryError } from '@b2b-system/web-core/components';
import { isNotFound } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';

import { getGroupListQueryOptions } from '@/apis/group/get-group-list/query';
import { getRoleDetailQueryOptions } from '@/apis/role/get-role-detail/query';
import { getRolePermissionsQueryOptions } from '@/apis/role/get-role-permissions/query';
import { getRoleUsersQueryOptions } from '@/apis/role/get-role-users/query';

import { useRoleDuplicateMutation } from '../../hooks/useRoleMutations';
import { useRolePermission } from '../../hooks/useRolePermission';
import {
  RoleDetailPermissionRoute,
  RoleDetailRevisionRoute,
  RoleDetailRoute,
  RoleListRoute,
} from '../../routes';
import { RoleBasicSection } from './components/RoleBasicSection';
import { RoleHolderSection } from './components/RoleHolderSection';
import { RolePermissionSection } from './components/RolePermissionSection';

export default function RoleDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { roleId } = RoleDetailRoute.useParams();
  const search = RoleListRoute.useSearch();
  const permission = useRolePermission();

  const role = useQuery(getRoleDetailQueryOptions(roleId));
  const rolePermissions = useQuery({
    ...getRolePermissionsQueryOptions(roleId),
    enabled: permission.canManagePermission || permission.canRead,
  });
  const holders = useQuery({
    ...getRoleUsersQueryOptions(roleId),
    enabled: permission.canViewUsers,
  });
  const holderGroups = useQuery({
    ...getGroupListQueryOptions({
      params: { offset: 0, limit: 100, roleId, sort: [{ sort: 'name', order: 'asc' }] },
    }),
    enabled: permission.canViewGroups,
  });

  const duplicateRole = useRoleDuplicateMutation();

  const close = () => void navigate({ to: RoleListRoute.to, search });
  const isSystem = role.data?.isSystem ?? false;

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => !open && close()}
        title={role.data?.name ?? t('role.detail.title')}
        description={role.data ? `${role.data.slug}` : undefined}
        size="lg"
        data-testid="role-detail-dialog"
        footer={
          <>
            {permission.canCreate && role.data && (
              <Button
                // 失敗由 mutation 的 onError 顯示
                onClick={() => duplicateRole.mutate({ params: { roleId, body: {} } })}
                loading={duplicateRole.isPending}
                data-testid="role-duplicate-button"
              >
                {t('role.duplicate.action')}
              </Button>
            )}
            {role.data && (
              <ButtonLink
                variant="secondary"
                to={RoleDetailRevisionRoute.to}
                params={{ roleId }}
                search={search}
                data-testid="role-revision-button"
              >
                {t('role.detail.revisions')}
              </ButtonLink>
            )}
            {permission.canManagePermission && !isSystem && (
              <ButtonLink
                variant="secondary"
                to={RoleDetailPermissionRoute.to}
                params={{ roleId }}
                search={search}
                data-testid="role-manage-permission-button"
              >
                {t('role.detail.managePermission')}
              </ButtonLink>
            )}
            <Button variant="primary" onClick={close}>
              {t('common.close')}
            </Button>
          </>
        }
      >
        {role.isPending && <Skeleton height={160} />}
        {/* 深層連結指向已刪除的角色：說明原因並提供返回，不留一個空白對話框 */}
        {role.isError && (
          <QueryError
            error={role.error}
            onRetry={isNotFound(role.error) ? undefined : () => void role.refetch()}
            action={
              <Button onClick={close} data-testid="role-detail-back">
                {t('role.detail.backToList')}
              </Button>
            }
            data-testid="role-detail-error"
          />
        )}

        {role.data && (
          <div className="flex flex-col gap-5">
            <RoleBasicSection role={role.data} canEdit={permission.canUpdate && !isSystem} />
            <RolePermissionSection
              isSuperAdmin={role.data.slug === 'super-admin'}
              permissions={rolePermissions.data?.permissions}
            />
            {(permission.canViewUsers || permission.canViewGroups) && (
              <RoleHolderSection
                holders={permission.canViewUsers ? holders.data?.items : undefined}
                groups={permission.canViewGroups ? holderGroups.data?.items : undefined}
              />
            )}
          </div>
        )}
      </Dialog>
      {/* 子路由的對話框與本對話框並列，不放進 Dialog 內：Base UI 的 Dialog 在 React 樹中巢狀時，
        背後列表的 Select 觸發按鈕會陷入 ref 更新迴圈（Maximum update depth exceeded）。 */}
      <Outlet />
    </>
  );
}
