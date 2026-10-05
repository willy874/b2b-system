import {
  isAppError,
  isVersionConflict,
  useErrorMessage,
  useErrorToast,
} from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { getGroupCreateMutationOptions } from '@/apis/group/create-group/mutation';
import { getGroupDeleteMutationOptions } from '@/apis/group/delete-group/mutation';
import { getGroupRestoreMutationOptions } from '@/apis/group/restore-group/mutation';
import { getGroupMembersUpdateMutationOptions } from '@/apis/group/update-group-members/mutation';
import { getGroupRolesUpdateMutationOptions } from '@/apis/group/update-group-roles/mutation';
import { getGroupUpdateMutationOptions } from '@/apis/group/update-group/mutation';
import { invalidateResources, Resource } from '@/apis/resources';
import { useIsFeatureReady } from '@/core/feature';
import { TenantFeature } from '@/shared/api-sdk';

import { DEFAULT_GROUP_SEARCH, GroupDetailRoute } from '../routes';

export function useGroupCreateMutation() {
  const toast = useToast();
  const { t } = useTranslation();

  return useMutation({
    ...getGroupCreateMutationOptions(),
    onSuccess: (group) => {
      invalidateResources([{ resource: Resource.GROUP, kind: 'create', id: group.id }]);
      toast.success(t('group.create.success', { name: group.name }));
    },
  });
}

/**
 * 編輯名稱與說明：帶編輯開始時的 `version`（樂觀鎖）。衝突時失效該群組讓畫面拿到最新版本，
 * 訊息交給表單（`VersionConflictAlert`）顯示、不彈 toast。
 */
export function useGroupUpdateMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();

  return useMutation({
    ...getGroupUpdateMutationOptions(),
    onSuccess: (group) => {
      invalidateResources([{ resource: Resource.GROUP, kind: 'update', id: group.id }]);
      toast.success(t('group.update.success'));
    },
    onError: (error, { params }) => {
      if (isVersionConflict(error)) {
        invalidateResources([{ resource: Resource.GROUP, kind: 'update', id: params.groupId }]);
        return;
      }
      showError(error);
    },
  });
}

/** 刪除＝移到回收桶；成功的提示附「復原」（還原時成員與持有的角色一起回來）。 */
export function useGroupDeleteMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  const restore = useGroupRestoreMutation();
  const canRestore = useIsFeatureReady(TenantFeature.trash);

  return useMutation({
    ...getGroupDeleteMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([{ resource: Resource.GROUP, kind: 'delete', id: params.groupId }]);
      toast.show({
        type: 'success',
        title: t('group.delete.success'),
        // 回收桶被平台關掉時還原端點回 404，不提供復原（docs/architecture/05-tenancy.md §12.2 D3）
        ...(canRestore && {
          action: {
            label: t('group.delete.undo'),
            onClick: () => restore.mutate({ params: { groupId: params.groupId } }),
          },
        }),
      });
    },
    onError: showError,
  });
}

/** 還原被名稱佔用擋下時，錯誤帶佔用的群組（`details.conflictingGroupId`）。 */
function conflictingGroupIdOf(error: unknown): string | undefined {
  if (!isAppError(error)) return undefined;
  const id = error.details?.conflictingGroupId;
  return typeof id === 'string' ? id : undefined;
}

/**
 * 還原刪除的群組。名稱已被別的群組使用時，提示附「查看該群組」直接連過去；
 * 其他錯誤（反提權、循環）照錯誤碼的訊息顯示。
 */
export function useGroupRestoreMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const showError = useErrorToast();
  const navigate = useNavigate();

  return useMutation({
    ...getGroupRestoreMutationOptions(),
    onSuccess: (group) => {
      // 重新出現在列表：以 create 宣告（回收桶由依賴圖跟著失效）
      invalidateResources([{ resource: Resource.GROUP, kind: 'create', id: group.id }]);
      toast.success(t('group.restore.success', { name: group.name }));
    },
    onError: (error) => {
      const conflictingGroupId = conflictingGroupIdOf(error);
      if (!conflictingGroupId) {
        showError(error);
        return;
      }
      toast.show({
        type: 'error',
        title: toMessage(error),
        action: {
          label: t('group.restore.viewConflicting'),
          onClick: () =>
            void navigate({
              to: GroupDetailRoute.to,
              params: { groupId: conflictingGroupId },
              search: DEFAULT_GROUP_SEARCH,
            }),
        },
      });
    },
  });
}

/** 增減成員（差異語意）。加入的成員取得群組與上層群組的角色，受反提權限制（docs/rbac/01-domain-model.md §9.3 D11）。 */
export function useGroupMembersUpdateMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();

  return useMutation({
    ...getGroupMembersUpdateMutationOptions(),
    onSuccess: (group) => {
      invalidateResources([{ resource: Resource.GROUP, kind: 'update', id: group.id }]);
      toast.success(t('group.member.success'));
    },
    onError: showError,
  });
}

/** 增減群組持有的角色（差異語意）。受反提權限制；super-admin 一律拒絕（docs/rbac/01-domain-model.md §9.3 D12）。 */
export function useGroupRolesUpdateMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();

  return useMutation({
    ...getGroupRolesUpdateMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([{ resource: Resource.GROUP, kind: 'update', id: params.groupId }]);
      toast.success(t('group.role.success'));
    },
    onError: showError,
  });
}
