import { useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation, useQuery } from '@tanstack/react-query';

import { invalidateResources, Resource } from '@/apis/resources';
import { getUserIdentitiesQueryOptions } from '@/apis/user/get-user-identities/query';
import { getUnlinkUserIdentityMutationOptions } from '@/apis/user/unlink-user-identity/mutation';

/** 這位使用者連結的外部身分（docs/architecture/04-sso.md §3.3.4）：檢視（`user:read`）與解除（`user:update`）。 */
export function useUserIdentities(userId: string) {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  const identities = useQuery(getUserIdentitiesQueryOptions(userId));

  const unlink = useMutation({
    ...getUnlinkUserIdentityMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([{ resource: Resource.USER, kind: 'update', id: params.userId }]);
      toast.success(t('user.identities.unlinked'));
    },
    onError: showError,
  });

  return { identities, unlink };
}
