import { isVersionConflict, useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation } from '@tanstack/react-query';

import { invalidateResources, Resource } from '@/apis/resources';
import { getServiceAccountTokenCreateMutationOptions } from '@/apis/service-account/create-service-account-token/mutation';
import { getServiceAccountCreateMutationOptions } from '@/apis/service-account/create-service-account/mutation';
import { getServiceAccountDeleteMutationOptions } from '@/apis/service-account/delete-service-account/mutation';
import { getServiceAccountRolesReplaceMutationOptions } from '@/apis/service-account/replace-service-account-roles/mutation';
import { getServiceAccountTokenRevokeMutationOptions } from '@/apis/service-account/revoke-service-account-token/mutation';
import { getServiceAccountUpdateMutationOptions } from '@/apis/service-account/update-service-account/mutation';

export function useServiceAccountCreateMutation() {
  const toast = useToast();
  const { t } = useTranslation();

  return useMutation({
    ...getServiceAccountCreateMutationOptions(),
    onSuccess: (account) => {
      invalidateResources([
        { resource: Resource.SERVICE_ACCOUNT, kind: 'create', id: account.id },
        // 持有者人數變了
        ...account.roles.map((role) => ({
          resource: Resource.ROLE,
          kind: 'update' as const,
          id: role.id,
        })),
      ]);
      toast.success(t('serviceAccount.create.success', { name: account.name }));
    },
  });
}

/**
 * 改名、停用、啟用：帶編輯開始時的 `version`（樂觀鎖）。衝突時失效該帳號讓畫面拿到最新版本，
 * 訊息交給表單（`VersionConflictAlert`）顯示、不彈 toast。
 */
export function useServiceAccountUpdateMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();

  return useMutation({
    ...getServiceAccountUpdateMutationOptions(),
    onSuccess: (account) => {
      invalidateResources([{ resource: Resource.SERVICE_ACCOUNT, kind: 'update', id: account.id }]);
      toast.success(t('serviceAccount.update.success'));
    },
    onError: (error, { params }) => {
      if (isVersionConflict(error)) {
        invalidateResources([
          { resource: Resource.SERVICE_ACCOUNT, kind: 'update', id: params.serviceAccountId },
        ]);
        return;
      }
      showError(error);
    },
  });
}

/** 刪除不進回收桶、不能還原：成功的提示沒有「復原」。 */
export function useServiceAccountDeleteMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();

  return useMutation({
    ...getServiceAccountDeleteMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([
        { resource: Resource.SERVICE_ACCOUNT, kind: 'delete', id: params.serviceAccountId },
      ]);
      toast.success(t('serviceAccount.delete.success'));
    },
    onError: showError,
  });
}

/** 整批取代角色；別人剛改過時後端回 `SERVICE_ACCOUNT_ROLES_CONFLICT`，重抓後讓使用者重選。 */
export function useServiceAccountRolesReplaceMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();

  return useMutation({
    ...getServiceAccountRolesReplaceMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([
        { resource: Resource.SERVICE_ACCOUNT, kind: 'update', id: params.serviceAccountId },
        // 新舊角色的持有者人數都變了
        ...[...new Set([...params.body.roleIds, ...params.body.expectedRoleIds])].map((id) => ({
          resource: Resource.ROLE,
          kind: 'update' as const,
          id,
        })),
      ]);
      toast.success(t('serviceAccount.role.success'));
    },
    onError: (error, { params }) => {
      invalidateResources([
        { resource: Resource.SERVICE_ACCOUNT, kind: 'update', id: params.serviceAccountId },
      ]);
      showError(error);
    },
  });
}

/** 建立 token：錯誤由建立對話框顯示，不彈 toast。 */
export function useServiceAccountTokenCreateMutation() {
  return useMutation({
    ...getServiceAccountTokenCreateMutationOptions(),
    onSuccess: (created, { params }) => {
      invalidateResources([
        {
          resource: Resource.API_TOKEN,
          kind: 'create',
          id: created.apiToken.id,
          refs: { [Resource.SERVICE_ACCOUNT]: [params.serviceAccountId] },
        },
      ]);
    },
  });
}

export function useServiceAccountTokenRevokeMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();

  return useMutation({
    ...getServiceAccountTokenRevokeMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([
        {
          resource: Resource.API_TOKEN,
          kind: 'update',
          id: params.tokenId,
          refs: { [Resource.SERVICE_ACCOUNT]: [params.serviceAccountId] },
        },
      ]);
      toast.success(t('apiToken.revoke.success'));
    },
    onError: showError,
  });
}
