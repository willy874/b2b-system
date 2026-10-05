import { useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation, useQuery } from '@tanstack/react-query';

import { getUserApiTokensQueryOptions } from '@/apis/api-token/get-user-api-tokens/query';
import { getUserApiTokenRevokeMutationOptions } from '@/apis/api-token/revoke-user-api-token/mutation';
import { invalidateResources, Resource } from '@/apis/resources';

/** 這位使用者的個人 API token（管理者檢視與撤銷，`user:update`；docs/architecture/06-external-api.md §9.2 D14）。 */
export function useUserApiTokens(userId: string) {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  const tokens = useQuery(getUserApiTokensQueryOptions(userId));

  const revoke = useMutation({
    ...getUserApiTokenRevokeMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([{ resource: Resource.API_TOKEN, kind: 'update', id: params.tokenId }]);
      toast.success(t('apiToken.revoke.success'));
    },
    onError: showError,
  });

  return { tokens, revoke };
}
