import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { QueryBoundary } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { getGroupDetailQueryOptions } from '@/apis/group/get-group-detail/query';
import { getGroupRolesQueryOptions } from '@/apis/group/get-group-roles/query';
import { getRoleOptionsQueryOptions } from '@/apis/role/get-role-list/query';

import { useGroupPermission } from '../../hooks/useGroupPermission';
import { GroupDetailRoute, GroupListRoute } from '../../routes';
import { GroupBasicSection } from './components/GroupBasicSection';
import { GroupMemberSection } from './components/GroupMemberSection';
import { GroupRoleSection } from './components/GroupRoleSection';

export default function GroupDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { groupId } = GroupDetailRoute.useParams();
  const search = GroupListRoute.useSearch();
  const permission = useGroupPermission();

  const group = useQuery(getGroupDetailQueryOptions(groupId));
  const roles = useQuery({
    ...getGroupRolesQueryOptions(groupId),
    enabled: permission.canViewRoles,
  });
  // 可勾選的角色：要能讓群組持有角色，且讀得到角色清單
  const canPickRoles = permission.canAssignRole && permission.canViewRoles;
  const roleOptions = useQuery({ ...getRoleOptionsQueryOptions(), enabled: canPickRoles });

  const close = () => void navigate({ to: GroupListRoute.to, search });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={group.data?.name ?? t('group.detail.title')}
      size="lg"
      data-testid="group-detail-dialog"
      footer={
        <Button variant="primary" onClick={close}>
          {t('common.close')}
        </Button>
      }
    >
      {/* 深層連結指向已刪除的群組：說明原因並提供返回，不留一個空白對話框 */}
      <QueryBoundary
        query={group}
        skeleton={<Skeleton height={160} />}
        backAction={
          <Button onClick={close} data-testid="group-detail-back">
            {t('group.detail.backToList')}
          </Button>
        }
        data-testid="group-detail-error"
      >
        {(current) => (
          <div className="flex flex-col gap-5">
            <GroupBasicSection group={current} canEdit={permission.canUpdate} />
            {permission.canViewRoles && (
              <GroupRoleSection
                groupId={groupId}
                roles={roles}
                roleOptions={canPickRoles ? roleOptions.data?.items : undefined}
              />
            )}
            {permission.canViewMembers && (
              <GroupMemberSection
                groupId={groupId}
                memberCount={current.memberCount}
                canEdit={permission.canUpdate}
              />
            )}
          </div>
        )}
      </QueryBoundary>
    </Dialog>
  );
}
