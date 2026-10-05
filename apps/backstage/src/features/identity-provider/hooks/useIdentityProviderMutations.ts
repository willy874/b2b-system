import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation } from '@tanstack/react-query';

import { getCreateIdentityProviderMutationOptions } from '@/apis/identity-provider/create-identity-provider/mutation';
import { getDeleteIdentityProviderMutationOptions } from '@/apis/identity-provider/delete-identity-provider/mutation';
import { getUpdateIdentityProviderMutationOptions } from '@/apis/identity-provider/update-identity-provider/mutation';
import { invalidateResources, Resource } from '@/apis/resources';

/** 外部 IdP 連線（docs/architecture/04-sso.md §12.2 D8）。錯誤不在這裡吞掉：由對話框的呼叫端顯示。 */
export function useCreateIdentityProviderMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getCreateIdentityProviderMutationOptions(),
    onSuccess: (provider) => {
      invalidateResources([
        { resource: Resource.IDENTITY_PROVIDER, kind: 'create', id: provider.id },
      ]);
      toast.success(t('identityProvider.create.success'));
    },
  });
}

export function useUpdateIdentityProviderMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getUpdateIdentityProviderMutationOptions(),
    onSuccess: (provider) => {
      invalidateResources([
        { resource: Resource.IDENTITY_PROVIDER, kind: 'update', id: provider.id },
      ]);
      toast.success(t('identityProvider.edit.success'));
    },
  });
}

export function useDeleteIdentityProviderMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getDeleteIdentityProviderMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([
        { resource: Resource.IDENTITY_PROVIDER, kind: 'delete', id: params.id },
      ]);
      toast.success(t('identityProvider.remove.success'));
    },
  });
}
