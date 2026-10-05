import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { QueryError } from '@b2b-system/web-core/components';
import { isNotFound } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { getRoleOptionsQueryOptions } from '@/apis/role/get-role-list/query';
import { getServiceAccountDetailQueryOptions } from '@/apis/service-account/get-service-account-detail/query';

import { useServiceAccountPermission } from '../../hooks/useServiceAccountPermission';
import { ServiceAccountDetailRoute, ServiceAccountListRoute } from '../../routes';
import { ServiceAccountBasicSection } from './components/ServiceAccountBasicSection';
import { ServiceAccountRoleSection } from './components/ServiceAccountRoleSection';
import { ServiceAccountTokenSection } from './components/ServiceAccountTokenSection';

export default function ServiceAccountDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { serviceAccountId } = ServiceAccountDetailRoute.useParams();
  const search = ServiceAccountListRoute.useSearch();
  const permission = useServiceAccountPermission();

  const account = useQuery(getServiceAccountDetailQueryOptions(serviceAccountId));
  const roleOptions = useQuery({
    ...getRoleOptionsQueryOptions(),
    enabled: permission.canAssignRole,
  });

  const close = () => void navigate({ to: ServiceAccountListRoute.to, search });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      title={account.data?.name ?? t('serviceAccount.detail.title')}
      size="lg"
      data-testid="service-account-detail-dialog"
      footer={
        <Button variant="primary" onClick={close}>
          {t('common.close')}
        </Button>
      }
    >
      {account.isPending && <Skeleton height={160} />}
      {/* 深層連結指向已刪除的帳號：說明原因並提供返回，不留一個空白對話框 */}
      {account.isError && (
        <QueryError
          error={account.error}
          onRetry={isNotFound(account.error) ? undefined : () => void account.refetch()}
          action={
            <Button onClick={close} data-testid="service-account-detail-back">
              {t('serviceAccount.detail.backToList')}
            </Button>
          }
          data-testid="service-account-detail-error"
        />
      )}

      {account.data && (
        <div className="flex flex-col gap-5">
          <ServiceAccountBasicSection account={account.data} canEdit={permission.canUpdate} />
          <ServiceAccountRoleSection
            serviceAccountId={serviceAccountId}
            roles={account.data.roles}
            roleOptions={permission.canAssignRole ? roleOptions.data?.items : undefined}
          />
          <ServiceAccountTokenSection
            serviceAccountId={serviceAccountId}
            active={account.data.status === 'active'}
            canManage={permission.canManageTokens}
            scopeOptions={permission.scopeOptions}
          />
        </div>
      )}
    </Dialog>
  );
}
