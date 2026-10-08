import { isVersionConflict, useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation } from '@tanstack/react-query';

import { getOrgUnitCreateMutationOptions } from '@/apis/org-unit/create-org-unit/mutation';
import { getOrgUnitDeleteMutationOptions } from '@/apis/org-unit/delete-org-unit/mutation';
import { getOrgUnitMoveMutationOptions } from '@/apis/org-unit/move-org-unit/mutation';
import { getOrgUnitRestoreMutationOptions } from '@/apis/org-unit/restore-org-unit/mutation';
import { getOrgUnitMembersUpdateMutationOptions } from '@/apis/org-unit/update-org-unit-members/mutation';
import { getOrgUnitUpdateMutationOptions } from '@/apis/org-unit/update-org-unit/mutation';
import { invalidateResources, Resource } from '@/apis/resources';
import { useIsFeatureReady } from '@/core/feature';
import { TenantFeature } from '@/shared/api-sdk';

export function useOrgUnitCreateMutation() {
  const toast = useToast();
  const { t } = useTranslation();

  return useMutation({
    ...getOrgUnitCreateMutationOptions(),
    onSuccess: (unit) => {
      invalidateResources([{ resource: Resource.ORG_UNIT, kind: 'create', id: unit.id }]);
      toast.success(t('organization.create.success', { name: unit.name }));
    },
    // 錯誤（名稱、代碼重複）交給表單顯示
  });
}

/**
 * 編輯名稱、代碼與說明：帶編輯開始時的 `version`（樂觀鎖）。衝突時失效該部門讓畫面拿到最新版本，
 * 訊息交給表單（`VersionConflictAlert`）顯示、不彈 toast。
 */
export function useOrgUnitUpdateMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();

  return useMutation({
    ...getOrgUnitUpdateMutationOptions(),
    onSuccess: (unit) => {
      invalidateResources([{ resource: Resource.ORG_UNIT, kind: 'update', id: unit.id }]);
      toast.success(t('organization.update.success'));
    },
    onError: (error, { params }) => {
      if (isVersionConflict(error)) {
        invalidateResources([{ resource: Resource.ORG_UNIT, kind: 'update', id: params.unitId }]);
        return;
      }
      showError(error);
    },
  });
}

/** 換上層（循環、超過層數、版本衝突由後端擋，以錯誤碼的訊息顯示）。 */
export function useOrgUnitMoveMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();

  return useMutation({
    ...getOrgUnitMoveMutationOptions(),
    onSuccess: (unit) => {
      invalidateResources([{ resource: Resource.ORG_UNIT, kind: 'update', id: unit.id }]);
      toast.success(t('organization.move.success', { name: unit.name }));
    },
    onError: (error, { params }) => {
      // 衝突時先讓畫面拿到最新版本，使用者重試時才會帶對的 version
      if (isVersionConflict(error)) {
        invalidateResources([{ resource: Resource.ORG_UNIT, kind: 'update', id: params.unitId }]);
      }
      showError(error);
    },
  });
}

/** 刪除＝移到回收桶（還有下層部門時後端回 409 `ORG_UNIT_HAS_CHILDREN`）；成功的提示附「復原」。 */
export function useOrgUnitDeleteMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();
  const restore = useOrgUnitRestoreMutation();
  const canRestore = useIsFeatureReady(TenantFeature.trash);

  return useMutation({
    ...getOrgUnitDeleteMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([{ resource: Resource.ORG_UNIT, kind: 'delete', id: params.unitId }]);
      toast.show({
        type: 'success',
        title: t('organization.delete.success'),
        // 回收桶被平台關掉時還原端點回 404，不提供復原（docs/architecture/05-tenancy.md §12.2 D3）
        ...(canRestore && {
          action: {
            label: t('organization.delete.undo'),
            onClick: () => restore.mutate({ params: { unitId: params.unitId } }),
          },
        }),
      });
    },
    onError: showError,
  });
}

/** 還原刪除的部門（成員資格一併恢復）；上層已刪除時以錯誤碼的訊息請使用者先還原上層。 */
export function useOrgUnitRestoreMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();

  return useMutation({
    ...getOrgUnitRestoreMutationOptions(),
    onSuccess: (unit) => {
      // 重新出現在樹上：以 create 宣告（回收桶由依賴圖跟著失效）
      invalidateResources([{ resource: Resource.ORG_UNIT, kind: 'create', id: unit.id }]);
      toast.success(t('organization.restore.success', { name: unit.name }));
    },
    onError: showError,
  });
}

/** 增減、修改成員（差異語意）；不能改自己（403 `AUTHZ_SELF_MODIFY`，docs/architecture/backend/23-organization.md §10 D6）。 */
export function useOrgUnitMembersUpdateMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  const showError = useErrorToast();

  return useMutation({
    ...getOrgUnitMembersUpdateMutationOptions(),
    onSuccess: (unit) => {
      invalidateResources([{ resource: Resource.ORG_UNIT, kind: 'update', id: unit.id }]);
      toast.success(t('organization.member.success'));
    },
    onError: showError,
  });
}
