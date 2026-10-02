import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { invalidateResources, Resource } from '@/apis/resources';
import { getRoleCreateMutationOptions } from '@/apis/role/create-role/mutation';
import { getRoleDeleteMutationOptions } from '@/apis/role/delete-role/mutation';
import { getRoleDuplicateMutationOptions } from '@/apis/role/duplicate-role/mutation';
import { getGrantRolePermissionsMutationOptions } from '@/apis/role/grant-role-permissions/mutation';
import { getRoleRestoreMutationOptions } from '@/apis/role/restore-role/mutation';
import { getRoleRevertRevisionMutationOptions } from '@/apis/role/revert-role-revision/mutation';
import { getRoleUpdateMutationOptions } from '@/apis/role/update-role/mutation';
import {
  ErrorCodes,
  isAppError,
  isVersionConflict,
  useErrorMessage,
  useErrorToast,
} from '@/core/errors';
import { useIsFeatureReady } from '@/core/feature';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';
import { TenantFeature } from '@/shared/api-sdk';

import { DEFAULT_ROLE_SEARCH, RoleDetailRoute } from '../routes';

export function useRoleCreateMutation() {
  const toast = useToast();
  const { t } = useTranslation();

  return useMutation({
    ...getRoleCreateMutationOptions(),
    onSuccess: (role) => {
      invalidateResources([{ resource: Resource.ROLE, kind: 'create' }]);
      toast.success(t('role.create.success', { name: role.name }));
    },
  });
}

/**
 * 編輯角色：表單帶上編輯開始時的 `version`（樂觀鎖）。別人搶先改過時後端回 `ROLE_VERSION_CONFLICT`，
 * 這裡失效該角色讓畫面拿到最新的內容與版本，訊息交給表單（`VersionConflictAlert`）顯示、不彈 toast。
 */
export function useRoleUpdateMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();

  return useMutation({
    ...getRoleUpdateMutationOptions(),
    onSuccess: (role) => {
      invalidateResources([{ resource: Resource.ROLE, kind: 'update', id: role.id }]);
      toast.success(t('role.update.success'));
    },
    onError: (error, { params }) => {
      if (isVersionConflict(error)) {
        invalidateResources([{ resource: Resource.ROLE, kind: 'update', id: params.roleId }]);
        return;
      }
      showError(error);
    },
  });
}

/**
 * 刪除角色。成功的提示附「復原」：刪除只是移到回收桶（docs/architecture/backend/14-revisions.md §9 R3），按下就呼叫還原端點，原本的持有者一併回來。
 * 刪除與還原都要 `role:delete`，所以刪得掉的人一定按得了復原（反提權仍可能擋下：角色帶了自己沒有的權限鍵）。
 */
export function useRoleDeleteMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  const restore = useRoleRestoreMutation();
  const canRestore = useIsFeatureReady(TenantFeature.trash);

  return useMutation({
    ...getRoleDeleteMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([{ resource: Resource.ROLE, kind: 'delete', id: params.roleId }]);
      toast.show({
        type: 'success',
        title: t('role.delete.success'),
        // 回收桶被平台關掉時還原端點回 404，不提供復原（docs/architecture/05-tenancy.md §12.2 D3）
        ...(canRestore && {
          action: {
            label: t('role.delete.undo'),
            onClick: () => restore.mutate({ params: { roleId: params.roleId } }),
          },
        }),
      });
    },
    onError: showError,
  });
}

/** 還原被名稱或 slug 佔用擋下時，錯誤帶佔用的角色（`details.conflictingRoleId`）。 */
function conflictingRoleIdOf(error: unknown): string | undefined {
  if (!isAppError(error)) return undefined;
  const id = error.details?.conflictingRoleId;
  return typeof id === 'string' ? id : undefined;
}

/**
 * 還原刪除的角色（`POST /roles/:id/restore`，docs/architecture/backend/14-revisions.md §9 R3）。名稱或 slug 已被別的角色使用時，
 * 提示附「查看該角色」直接連過去（先改名或刪除它）；角色帶了自己沒有的權限鍵（反提權）時說明原因。
 */
export function useRoleRestoreMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const showError = useErrorToast();
  const navigate = useNavigate();

  return useMutation({
    ...getRoleRestoreMutationOptions(),
    onSuccess: (role) => {
      // 重新出現在列表：以 create 宣告（回收桶由依賴圖跟著失效）；持有者的角色摘要以 update 宣告。
      // 自己的 profile 不必重抓：反提權保證角色的鍵自己都已持有。其他持有者由伺服器推 userRole update
      invalidateResources([
        { resource: Resource.ROLE, kind: 'create', id: role.id },
        { resource: Resource.ROLE, kind: 'update', id: role.id },
      ]);
      toast.success(
        role.holdersRestored > 0
          ? t('role.restore.successWithHolders', { name: role.name, count: role.holdersRestored })
          : t('role.restore.success', { name: role.name }),
      );
    },
    onError: (error) => {
      if (isAppError(error) && error.code === ErrorCodes.AUTHZ_ESCALATION) {
        toast.error(t('role.restore.escalation'));
        return;
      }
      const conflictingRoleId = conflictingRoleIdOf(error);
      if (!conflictingRoleId) {
        showError(error);
        return;
      }
      toast.show({
        type: 'error',
        title: toMessage(error),
        action: {
          label: t('role.restore.viewConflicting'),
          onClick: () =>
            void navigate({
              to: RoleDetailRoute.to,
              params: { roleId: conflictingRoleId },
              search: DEFAULT_ROLE_SEARCH,
            }),
        },
      });
    },
  });
}

export function useRoleDuplicateMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();

  return useMutation({
    ...getRoleDuplicateMutationOptions(),
    onSuccess: (role) => {
      invalidateResources([{ resource: Resource.ROLE, kind: 'create' }]);
      const skipped = role.skippedPermissions ?? [];
      if (skipped.length) {
        toast.warning(t('role.duplicate.partial', { count: skipped.length }));
      } else {
        toast.success(t('role.duplicate.success', { name: role.name }));
      }
    },
    onError: showError,
  });
}

export function useGrantRolePermissionsMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();

  return useMutation({
    ...getGrantRolePermissionsMutationOptions(),
    onSuccess: (_, { params }) => {
      // 自己持有這個角色時，依賴圖會一併失效 profile
      invalidateResources([
        { resource: Resource.ROLE_PERMISSION, kind: 'update', id: params.roleId },
      ]);
      toast.success(t('role.permission.success'));
    },
    onError: showError,
  });
}

/**
 * 還原到某一版（`POST /roles/:id/revisions/:version/revert`，docs/architecture/backend/14-revisions.md §9 R5）。帶確認時看到的角色 `version`（樂觀鎖）：
 * 別人搶先改過時失效該角色、不彈 toast，由頁面的 `VersionConflictAlert` 說明；權限鍵帶了自己沒有的（反提權）時說明原因。
 */
export function useRoleRevertRevisionMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();

  return useMutation({
    ...getRoleRevertRevisionMutationOptions(),
    onSuccess: (role, { params }) => {
      // 名稱、說明與權限鍵都可能變了：權限鍵的變更也要宣告（自己持有這個角色時 profile 跟著重抓）
      invalidateResources([
        { resource: Resource.ROLE, kind: 'update', id: role.id },
        { resource: Resource.ROLE_PERMISSION, kind: 'update', id: role.id },
      ]);
      toast.success(t('role.revision.revert.success', { version: params.version }));
    },
    onError: (error, { params }) => {
      if (isVersionConflict(error)) {
        invalidateResources([{ resource: Resource.ROLE, kind: 'update', id: params.roleId }]);
        return;
      }
      if (isAppError(error) && error.code === ErrorCodes.AUTHZ_ESCALATION) {
        toast.error(t('role.revision.revert.escalation'));
        return;
      }
      showError(error);
    },
  });
}
