import { useMutation } from '@tanstack/react-query';

import { getAddTenantDomainMutationOptions } from '@/apis/platform-tenant/add-tenant-domain/mutation';
import { getCreateTenantMutationOptions } from '@/apis/platform-tenant/create-tenant/mutation';
import { getDeleteTenantMutationOptions } from '@/apis/platform-tenant/delete-tenant/mutation';
import { getDisableTenantMutationOptions } from '@/apis/platform-tenant/disable-tenant/mutation';
import { getEnableTenantMutationOptions } from '@/apis/platform-tenant/enable-tenant/mutation';
import { getRemoveTenantDomainMutationOptions } from '@/apis/platform-tenant/remove-tenant-domain/mutation';
import { getRetryTenantProvisioningMutationOptions } from '@/apis/platform-tenant/retry-tenant-provisioning/mutation';
import { getUpdateTenantMutationOptions } from '@/apis/platform-tenant/update-tenant/mutation';
import { invalidateResources, Resource } from '@/apis/resources';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';
import type { PlatformTenant } from '@/shared/api-sdk';

type ChangeKind = 'create' | 'update' | 'delete';

/** 寫入成功：失效租戶的清單與詳情並提示。錯誤不在這裡吞掉，由呼叫端顯示。 */
function useTenantChange(kind: ChangeKind, messageKey: string) {
  const toast = useToast();
  const { t } = useTranslation();
  return (id: string) => {
    invalidateResources([{ resource: Resource.TENANT, kind, id }]);
    toast.success(t(messageKey));
  };
}

export function useCreateTenantMutation() {
  const changed = useTenantChange('create', 'tenant.create.success');
  return useMutation({
    ...getCreateTenantMutationOptions(),
    onSuccess: (tenant: PlatformTenant) => changed(tenant.id),
  });
}

export function useUpdateTenantMutation() {
  const changed = useTenantChange('update', 'tenant.rename.success');
  return useMutation({
    ...getUpdateTenantMutationOptions(),
    onSuccess: (tenant: PlatformTenant) => changed(tenant.id),
  });
}

/** 試行開關的租戶層覆寫（docs/adr/0022-feature-flags.md D7）：列表上「覆寫它的租戶數」也跟著變。 */
export function useUpdateTenantFlagsMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getUpdateTenantMutationOptions(),
    onSuccess: (tenant: PlatformTenant) => {
      invalidateResources([
        { resource: Resource.TENANT, kind: 'update', id: tenant.id },
        { resource: Resource.FEATURE_FLAG, kind: 'update' },
      ]);
      toast.success(t('tenant.flag.success'));
    },
  });
}

/** feature 參數（docs/adr/0033-feature-params-and-webhook-targets.md D3）：只送要改的項目，`null` 回到預設。 */
export function useUpdateTenantFeatureParamsMutation() {
  const changed = useTenantChange('update', 'tenant.param.success');
  return useMutation({
    ...getUpdateTenantMutationOptions(),
    onSuccess: (tenant: PlatformTenant) => changed(tenant.id),
  });
}

export function useRetryTenantProvisioningMutation() {
  const changed = useTenantChange('update', 'tenant.retry.success');
  return useMutation({
    ...getRetryTenantProvisioningMutationOptions(),
    onSuccess: (tenant: PlatformTenant) => changed(tenant.id),
  });
}

export function useDisableTenantMutation() {
  const changed = useTenantChange('update', 'tenant.disable.success');
  return useMutation({
    ...getDisableTenantMutationOptions(),
    onSuccess: (tenant: PlatformTenant) => changed(tenant.id),
  });
}

export function useEnableTenantMutation() {
  const changed = useTenantChange('update', 'tenant.enable.success');
  return useMutation({
    ...getEnableTenantMutationOptions(),
    onSuccess: (tenant: PlatformTenant) => changed(tenant.id),
  });
}

export function useDeleteTenantMutation() {
  const changed = useTenantChange('delete', 'tenant.remove.success');
  return useMutation({
    ...getDeleteTenantMutationOptions(),
    onSuccess: (_, { params }) => changed(params.id),
  });
}

export function useAddTenantDomainMutation() {
  const changed = useTenantChange('update', 'tenant.domain.addSuccess');
  return useMutation({
    ...getAddTenantDomainMutationOptions(),
    onSuccess: (tenant: PlatformTenant) => changed(tenant.id),
  });
}

export function useRemoveTenantDomainMutation() {
  const changed = useTenantChange('update', 'tenant.domain.removeSuccess');
  return useMutation({
    ...getRemoveTenantDomainMutationOptions(),
    onSuccess: (tenant: PlatformTenant) => changed(tenant.id),
  });
}
