import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { QueryBoundary } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { getRoleOptionsQueryOptions } from '@/apis/role/get-role-list/query';
import { getUserDetailQueryOptions } from '@/apis/user/get-user-detail/query';
import { ResourcePanels } from '@/core/resource-panel';

import { useUserPermission } from '../../hooks/useUserPermission';
import { UserDetailRoute, UserListRoute } from '../../routes';
import { UserApiTokenSection } from './components/UserApiTokenSection';
import { UserAvatarSection } from './components/UserAvatarSection';
import { UserBasicSection } from './components/UserBasicSection';
import { UserGroupSection } from './components/UserGroupSection';
import { UserIdentitySection } from './components/UserIdentitySection';
import { UserMfaSection } from './components/UserMfaSection';
import { UserOrgUnitSection } from './components/UserOrgUnitSection';
import { UserPermissionSourceSection } from './components/UserPermissionSourceSection';
import { UserRoleSection } from './components/UserRoleSection';
import { UserTagSection } from './components/UserTagSection';

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
      {/* 深層連結指向已刪除的使用者：說明原因並提供返回，不留一個空白對話框 */}
      <QueryBoundary
        query={user}
        skeleton={<Skeleton height={200} />}
        backAction={
          <Button onClick={close} data-testid="user-detail-back">
            {t('user.detail.backToList')}
          </Button>
        }
        data-testid="user-detail-error"
      >
        {(current) => (
          <div className="flex flex-col gap-5">
            <UserAvatarSection user={current} canUpdate={permission.canUpdate} />
            <UserBasicSection user={current} canUpdate={permission.canUpdate} isSelf={isSelf} />
            <UserRoleSection
              user={current}
              roleOptions={roles.data?.items}
              canAssignRole={permission.canAssignRole}
              isSelf={isSelf}
            />
            <UserTagSection user={current} canEdit={permission.canUpdate} />
            {permission.canReadGroups && <UserGroupSection userId={userId} />}
            {permission.canReadOrgUnits && <UserOrgUnitSection userId={userId} />}
            {(isSelf || permission.canExplain) && (
              <UserPermissionSourceSection userId={userId} displayName={current.displayName} />
            )}
            {permission.canManageApiTokens && <UserApiTokenSection userId={userId} />}
            {permission.canReadIdentities && (
              <UserIdentitySection userId={userId} canUnlink={permission.canUnlinkIdentity} />
            )}
            <UserMfaSection userId={userId} canReset={permission.canResetMfa && !isSelf} />
            {/* 通用面板（留言與關注，docs/architecture/frontend/22-comment.md §2）：由提供面板的 feature 登記 */}
            <ResourcePanels resourceType="user" resourceId={userId} />
          </div>
        )}
      </QueryBoundary>
    </Dialog>
  );
}
