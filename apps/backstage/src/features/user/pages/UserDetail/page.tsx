import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { getRoleOptionsQueryOptions } from '@/apis/role/get-role-list/query';
import { getUserDetailQueryOptions } from '@/apis/user/get-user-detail/query';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { Skeleton } from '@/components/Skeleton';
import { QueryError } from '@/core/components';
import { isNotFound } from '@/core/errors';
import { useTranslation } from '@/core/locales';

import { useUserPermission } from '../../hooks/useUserPermission';
import { UserDetailRoute, UserListRoute } from '../../routes';
import { UserBasicSection } from './components/UserBasicSection';
import { UserGroupSection } from './components/UserGroupSection';
import { UserPermissionSourceSection } from './components/UserPermissionSourceSection';
import { UserRoleSection } from './components/UserRoleSection';

export default function UserDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { userId } = UserDetailRoute.useParams();
  const search = UserListRoute.useSearch();
  const permission = useUserPermission();

  const profile = useQuery(getAuthProfileQueryOptions());
  const user = useQuery(getUserDetailQueryOptions(userId));
  const roles = useQuery({ ...getRoleOptionsQueryOptions(), enabled: permission.canReadRoles });

  const isSelf = profile.data?.user.id === userId;
  const close = () => void navigate({ to: UserListRoute.to, search });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={user.data?.displayName ?? t('user.detail.title')}
      description={user.data?.email}
      size="lg"
      data-testid="user-detail-dialog"
      footer={
        <Button variant="primary" onClick={close}>
          {t('common.close')}
        </Button>
      }
    >
      {user.isPending && <Skeleton height={200} />}
      {/* 深層連結指向已刪除的使用者：說明原因並提供返回，不留一個空白對話框 */}
      {user.isError && (
        <QueryError
          error={user.error}
          onRetry={isNotFound(user.error) ? undefined : () => void user.refetch()}
          action={
            <Button onClick={close} data-testid="user-detail-back">
              {t('user.detail.backToList')}
            </Button>
          }
          data-testid="user-detail-error"
        />
      )}

      {user.data && (
        <div className="flex flex-col gap-5">
          <UserBasicSection user={user.data} canUpdate={permission.canUpdate} isSelf={isSelf} />
          <UserRoleSection
            user={user.data}
            roleOptions={roles.data?.items}
            canAssignRole={permission.canAssignRole}
            isSelf={isSelf}
          />
          {permission.canReadGroups && <UserGroupSection userId={userId} />}
          {(isSelf || permission.canExplain) && <UserPermissionSourceSection userId={userId} />}
        </div>
      )}
    </Dialog>
  );
}
