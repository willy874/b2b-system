import { useMutation, useQuery } from '@tanstack/react-query';

import { getMyApiTokenCreateMutationOptions } from '@/apis/api-token/create-my-api-token/mutation';
import { getMyApiTokensQueryOptions } from '@/apis/api-token/get-my-api-tokens/query';
import { getMyApiTokenRevokeMutationOptions } from '@/apis/api-token/revoke-my-api-token/mutation';
import { invalidateResources, Resource } from '@/apis/resources';
import { useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';
import { usePermission } from '@/core/permission';

/** 個人 token 的到期上限（天，docs/architecture/06-external-api.md §9.2 D8）；租戶設定更短時由後端擋下。 */
export const PERSONAL_TOKEN_MAX_DAYS = 90;

/**
 * 自己的個人 API token（docs/architecture/06-external-api.md §9.2 D2）：列表、建立、撤銷。
 * 建立的錯誤由建立對話框顯示；撤銷的錯誤彈 toast。
 */
export function useMyApiTokens() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  const { permissions } = usePermission();
  const tokens = useQuery(getMyApiTokensQueryOptions());

  const create = useMutation({
    ...getMyApiTokenCreateMutationOptions(),
    onSuccess: (created) => {
      invalidateResources([
        { resource: Resource.API_TOKEN, kind: 'create', id: created.apiToken.id },
      ]);
    },
  });
  const revoke = useMutation({
    ...getMyApiTokenRevokeMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([{ resource: Resource.API_TOKEN, kind: 'update', id: params.tokenId }]);
      toast.success(t('apiToken.revoke.success'));
    },
    onError: showError,
  });

  return {
    tokens,
    create,
    revoke,
    /** 可以限縮到的權限鍵：自己持有的（以權限鍵本身當名稱，權限目錄要 `permission:read`）。 */
    scopeOptions: [...permissions].toSorted().map((key) => ({ key, label: key })),
  };
}
