import { Button, ButtonLink } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { QueryError } from '@b2b-system/web-core/components';
import { isNotFound } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';

import { getRoleDetailQueryOptions } from '@/apis/role/get-role-detail/query';
import { getRolePermissionsQueryOptions } from '@/apis/role/get-role-permissions/query';

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

/** 唯一不能改權限的角色（路由 `RoleDetailPermissionRoute` 與後端 `ROLE_SUPER_ADMIN_IMMUTABLE` 同一條規則）。 */
const SUPER_ADMIN_SLUG = 'super-admin';

export default function RoleDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { roleId } = RoleDetailRoute.useParams();
  const search = RoleListRoute.useSearch();
  const permission = useRolePermission();

  const role = useQuery(getRoleDetailQueryOptions(roleId));
  const rolePermissions = useQuery({
    ...getRolePermissionsQueryOptions(roleId),
    // GET /roles/:id/permissions 要 role:read ＋ permission:read：只有 role:read 時查了必定 403
    enabled: permission.canManagePermission,
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
            {/* 與路由守衛、後端一致：只有 super-admin 不能改權限（admin、auditor、member 可以，仍受反提權限制） */}
            {permission.canManagePermission && role.data && role.data.slug !== SUPER_ADMIN_SLUG && (
              <ButtonLink
                variant="secondary"
                to={RoleDetailPermissionRoute.to}
                params={{ roleId }}
                search={search}
                data-testid="role-manage-permission-button"
              >
                {permission.canGrantPermission
                  ? t('role.detail.managePermission')
                  : t('role.detail.viewPermission')}
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
              isSuperAdmin={role.data.slug === SUPER_ADMIN_SLUG}
              canView={permission.canManagePermission}
              query={rolePermissions}
            />
            {(permission.canViewUsers || permission.canViewGroups) && (
              <RoleHolderSection
                roleId={roleId}
                canViewUsers={permission.canViewUsers}
                canViewGroups={permission.canViewGroups}
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
