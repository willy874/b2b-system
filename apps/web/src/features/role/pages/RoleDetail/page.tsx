import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';

import { getRoleDetailQueryOptions } from '@/apis/role/get-role-detail/query';
import { getRolePermissionsQueryOptions } from '@/apis/role/get-role-permissions/query';
import { getRoleUsersQueryOptions } from '@/apis/role/get-role-users/query';
import { Button, ButtonLink } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Skeleton } from '@/components/Skeleton';
import { useTranslation } from '@/core/locales';

import { useRoleDuplicateMutation } from '../../hooks/useRoleMutations';
import { useRolePermission } from '../../hooks/useRolePermission';
import { RoleDetailPermissionRoute, RoleDetailRoute, RoleListRoute } from '../../routes';
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
                onClick={() =>
                  void duplicateRole
                    .mutateAsync({ params: { roleId, body: {} } })
                    .catch(() => undefined)
                }
                loading={duplicateRole.isPending}
                data-testid="role-duplicate-button"
              >
                {t('role.duplicate.action')}
              </Button>
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

        {role.data && (
          <div className="flex flex-col gap-5">
            <RoleBasicSection role={role.data} canEdit={permission.canUpdate && !isSystem} />
            <RolePermissionSection
              isSuperAdmin={role.data.slug === 'super-admin'}
              permissions={rolePermissions.data?.permissions}
            />
            {permission.canViewUsers && <RoleHolderSection holders={holders.data?.items} />}
          </div>
        )}
      </Dialog>
      {/* 子路由的對話框與本對話框並列，不放進 Dialog 內：Base UI 的 Dialog 在 React 樹中巢狀時，
        背後列表的 Select 觸發按鈕會陷入 ref 更新迴圈（Maximum update depth exceeded）。 */}
      <Outlet />
    </>
  );
}
