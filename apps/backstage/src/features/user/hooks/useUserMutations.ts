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

import { invalidateResources, Resource } from '@/apis/resources';
import { getResourceTagsReplaceMutationOptions } from '@/apis/tag/replace-resource-tags/mutation';
import { getAssignUserRolesMutationOptions } from '@/apis/user/assign-user-roles/mutation';
import { getUserCreateMutationOptions } from '@/apis/user/create-user/mutation';
import { getUserDeleteMutationOptions } from '@/apis/user/delete-user/mutation';
import { getUserResetPasswordMutationOptions } from '@/apis/user/reset-user-password/mutation';
import { getUserRestoreMutationOptions } from '@/apis/user/restore-user/mutation';
import { getUserUnlockMutationOptions } from '@/apis/user/unlock-user/mutation';
import { getUserUpdateMutationOptions } from '@/apis/user/update-user/mutation';
import { useIsFeatureReady } from '@/core/feature';
import { TenantFeature } from '@/shared/api-sdk';
import type { User } from '@/shared/api-sdk';

import { UserDetailRoute } from '../routes';

/** 使用者持有的角色：讓依賴圖只失效這幾個角色，而不是全部。 */
export const roleRefs = (user: Pick<User, 'roles'>) => ({
  role: user.roles.map((role) => role.id),
});

export function useUserCreateMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getUserCreateMutationOptions(),
    onSuccess: (user) => {
      invalidateResources([{ resource: Resource.USER, kind: 'create', refs: roleRefs(user) }]);
      toast.success(t('user.create.success', { email: user.email }));
    },
  });
}

/**
 * 換別人的頭像（docs/architecture/frontend/23-image-picker.md §8）：不是表單，選好就存，帶目前看到的 `version`。
 * 版本衝突時重抓並照常提示（使用者再選一次即可），不像表單那樣把訊息留給 `VersionConflictAlert`。
 */
export function useUserAvatarMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getUserUpdateMutationOptions(),
    onSuccess: (user) => {
      invalidateResources([
        { resource: Resource.USER, kind: 'update', id: user.id, refs: roleRefs(user) },
      ]);
      toast.success(t('user.avatar.saved'));
    },
    onError: (error, { params }) => {
      if (isVersionConflict(error)) {
        invalidateResources([{ resource: Resource.USER, kind: 'update', id: params.userId }]);
      }
      showError(error);
    },
  });
}

/**
 * 編輯使用者：表單帶上編輯開始時的 `version`（樂觀鎖）。別人搶先改過時後端回 `USER_VERSION_CONFLICT`，
 * 這裡失效該使用者讓畫面拿到最新的內容與版本，訊息交給表單（`VersionConflictAlert`）顯示、不彈 toast。
 */
export function useUserUpdateMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getUserUpdateMutationOptions(),
    onSuccess: (user) => {
      invalidateResources([
        { resource: Resource.USER, kind: 'update', id: user.id, refs: roleRefs(user) },
      ]);
      toast.success(t('user.update.success'));
    },
    onError: (error, { params }) => {
      if (isVersionConflict(error)) {
        invalidateResources([{ resource: Resource.USER, kind: 'update', id: params.userId }]);
        return;
      }
      showError(error);
    },
  });
}

/**
 * 刪除使用者。成功的提示附「復原」：刪除只是移到回收桶（docs/architecture/backend/14-revisions.md §9），按下就呼叫還原端點。
 * 刪除與還原都要 `user:delete`，所以刪得掉的人一定按得了復原。
 */
export function useUserDeleteMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  const restore = useUserRestoreMutation();
  const canRestore = useIsFeatureReady(TenantFeature.trash);
  return useMutation({
    ...getUserDeleteMutationOptions(),
    onSuccess: (_, { params }) => {
      // 不知道被刪的人持有哪些角色 → 角色端退回整批失效
      invalidateResources([{ resource: Resource.USER, kind: 'delete', id: params.userId }]);
      toast.show({
        type: 'success',
        title: t('user.delete.success'),
        // 回收桶被平台關掉時還原端點回 404，不提供復原（docs/architecture/05-tenancy.md §12.2 D3）
        ...(canRestore && {
          action: {
            label: t('user.delete.undo'),
            onClick: () => restore.mutate({ params: { userId: params.userId } }),
          },
        }),
      });
    },
    onError: showError,
  });
}

/** 還原被 email／username 佔用擋下時，錯誤帶佔用的帳號（`details.conflictingUserId`）。 */
function conflictingUserIdOf(error: unknown): string | undefined {
  if (!isAppError(error)) return undefined;
  const id = error.details?.conflictingUserId;
  return typeof id === 'string' ? id : undefined;
}

/**
 * 還原刪除的使用者（`POST /users/:id/restore`，docs/architecture/backend/14-revisions.md §9.2 D6）。email 或 username 已被別的帳號使用時，
 * 提示附「查看該帳號」直接連過去：email 不能改，管理者要先處理那個帳號。
 */
export function useUserRestoreMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const showError = useErrorToast();
  const navigate = useNavigate();
  return useMutation({
    ...getUserRestoreMutationOptions(),
    onSuccess: (user) => {
      // 重新出現在列表：以 create 宣告；回收桶的列表由依賴圖跟著失效
      invalidateResources([
        { resource: Resource.USER, kind: 'create', id: user.id, refs: roleRefs(user) },
      ]);
      toast.success(t('user.restore.success', { name: user.displayName }));
    },
    onError: (error) => {
      const conflictingUserId = conflictingUserIdOf(error);
      if (!conflictingUserId) {
        showError(error);
        return;
      }
      toast.show({
        type: 'error',
        title: toMessage(error),
        action: {
          label: t('user.restore.viewConflicting'),
          onClick: () =>
            void navigate({ to: UserDetailRoute.to, params: { userId: conflictingUserId } }),
        },
      });
    },
  });
}

/** `user` 是指派前的狀態：新舊角色都要失效（userCount 與持有者清單）。 */
export function useAssignUserRolesMutation(user: Pick<User, 'id' | 'roles'>) {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getAssignUserRolesMutationOptions(),
    onSuccess: (_, { params }) => {
      const roleIds = new Set([...roleRefs(user).role, ...params.body.roleIds]);
      // 指派給自己時，依賴圖會一併失效 profile
      invalidateResources([
        { resource: Resource.USER_ROLE, kind: 'update', id: user.id, refs: { role: [...roleIds] } },
      ]);
      toast.success(t('user.assignRole.success'));
    },
    onError: showError,
  });
}

export function useUserUnlockMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getUserUnlockMutationOptions(),
    onSuccess: (user) => {
      invalidateResources([
        { resource: Resource.USER, kind: 'update', id: user.id, refs: roleRefs(user) },
      ]);
      toast.success(t('user.unlock.success'));
    },
    onError: showError,
  });
}

export function useUserResetPasswordMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  return useMutation({
    ...getUserResetPasswordMutationOptions(),
    onSuccess: (_, { params }) => {
      // 畫面上看不到憑證，但會產生稽核紀錄
      invalidateResources([
        { resource: Resource.USER_CREDENTIAL, kind: 'update', id: params.userId },
      ]);
      toast.success(t('user.resetPassword.success'));
    },
    onError: showError,
  });
}

/** 整批取代使用者的標籤（docs/architecture/backend/18-tag.md §7.2 D7）：錯誤由對話框顯示，不彈 toast。 */
export function useUserTagsReplaceMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getResourceTagsReplaceMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([{ resource: Resource.USER, kind: 'update', id: params.resourceId }]);
      toast.success(t('tag.assign.success'));
    },
  });
}
