import { AlertDialog } from '@b2b-system/ui/AlertDialog';
import { Breadcrumbs } from '@b2b-system/ui/Breadcrumbs';
import { Button, IconButton } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import type { PlatformTenant } from '@/shared/api-sdk';

import { TenantStatus } from '../../../components/TenantStatus';
import {
  useDisableTenantMutation,
  useEnableTenantMutation,
  useRetryTenantProvisioningMutation,
} from '../../../hooks/useTenantMutations';
import type { useTenantPermission } from '../../../hooks/useTenantPermission';
import { DEFAULT_TENANT_SEARCH, TenantListRoute } from '../../../routes';
import { DeleteTenantDialog } from './DeleteTenantDialog';
import { RenameTenantDialog } from './RenameTenantDialog';

type Confirming = 'disable' | 'remove' | undefined;

interface TenantDetailHeaderProps {
  tenant: PlatformTenant;
  permission: ReturnType<typeof useTenantPermission>;
}

/**
 * 麵包屑、名稱（改名）、狀態與操作：佈建失敗時重試（`tenant:create`）、停用／啟用（`tenant:update`）、
 * 刪除（`tenant:delete`，佈建中不行）。權限還沒水合時 `can*` 都是 false，按鈕不會先閃出來。
 */
export function TenantDetailHeader({ tenant, permission }: TenantDetailHeaderProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const showError = useErrorToast();
  const retry = useRetryTenantProvisioningMutation();
  const disable = useDisableTenantMutation();
  const enable = useEnableTenantMutation();
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState<Confirming>();
  const params = { params: { id: tenant.id } };

  return (
    <>
      <Breadcrumbs
        items={[
          {
            key: 'list',
            label: t('tenant.title'),
            render: <Link to={TenantListRoute.to} search={DEFAULT_TENANT_SEARCH} />,
          },
          { key: 'detail', label: tenant.name },
        ]}
        testIds={{ link: 'tenant-back' }}
        data-testid="tenant-breadcrumbs"
      />
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="m-0 truncate text-xl font-semibold" data-testid="tenant-name">
            {tenant.name}
          </h1>
          {permission.canUpdate && (
            <Tooltip content={t('tenant.rename.action')}>
              <IconButton
                size="sm"
                aria-label={t('tenant.rename.action')}
                onClick={() => setRenaming(true)}
                data-testid="tenant-rename"
              >
                <Icon name="edit" size={16} />
              </IconButton>
            </Tooltip>
          )}
          <TenantStatus status={tenant.status} />
        </div>
        <div className="flex gap-2">
          {permission.canCreate && tenant.status === 'failed' && (
            <Button
              loading={retry.isPending}
              onClick={() => void retry.mutateAsync(params).catch(showError)}
              data-testid="tenant-retry"
            >
              {t('tenant.retry.action')}
            </Button>
          )}
          {permission.canUpdate && tenant.status === 'active' && (
            <Button onClick={() => setConfirming('disable')} data-testid="tenant-disable">
              {t('tenant.disable.action')}
            </Button>
          )}
          {permission.canUpdate && tenant.status === 'disabled' && (
            <Button
              loading={enable.isPending}
              onClick={() => void enable.mutateAsync(params).catch(showError)}
              data-testid="tenant-enable"
            >
              {t('tenant.enable.action')}
            </Button>
          )}
          {permission.canDelete && tenant.status !== 'provisioning' && (
            <Button
              variant="danger"
              onClick={() => setConfirming('remove')}
              data-testid="tenant-remove"
            >
              {t('tenant.remove.action')}
            </Button>
          )}
        </div>
      </header>

      <RenameTenantDialog open={renaming} tenant={tenant} onClose={() => setRenaming(false)} />
      <AlertDialog
        open={confirming === 'disable'}
        onOpenChange={(open) => !open && setConfirming(undefined)}
        title={t('tenant.disable.title')}
        description={t('tenant.disable.confirm', { code: tenant.code })}
        confirmLabel={t('tenant.disable.action')}
        cancelLabel={t('common.cancel')}
        loading={disable.isPending}
        onConfirm={async () => {
          await disable.mutateAsync(params).catch(showError);
          setConfirming(undefined);
        }}
      />
      <DeleteTenantDialog
        open={confirming === 'remove'}
        tenant={tenant}
        onClose={() => setConfirming(undefined)}
        onDeleted={() => {
          setConfirming(undefined);
          void navigate({ to: TenantListRoute.to, search: DEFAULT_TENANT_SEARCH });
        }}
      />
    </>
  );
}
