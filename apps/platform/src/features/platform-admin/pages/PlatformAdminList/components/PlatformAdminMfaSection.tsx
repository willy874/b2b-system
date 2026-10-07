import { useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { MfaAccountStatusSection } from '@b2b-system/web-core/mfa';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation, useQuery } from '@tanstack/react-query';

import { getAdminMfaQueryOptions } from '@/apis/platform-admin/get-admin-mfa/query';
import { getResetAdminMfaMutationOptions } from '@/apis/platform-admin/reset-admin-mfa/mutation';
import { invalidateResources, Resource } from '@/apis/resources';
import { PermissionKey, usePermission } from '@/core/permission';

/**
 * 平台管理者的驗證方式與重設（docs/architecture/backend/21-mfa.md §8）。不能重設自己（`AUTHZ_SELF_MODIFY`）：
 * 自己的在個人資料頁管理。重設要 `platformAdmin:resetMfa`（與編輯分開授予）。
 */
export function PlatformAdminMfaSection({ adminId, isSelf }: { adminId: string; isSelf: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const showError = useErrorToast();
  const { can } = usePermission();
  const canReset = !isSelf && can(PermissionKey['platformAdmin:resetMfa']);
  const status = useQuery(getAdminMfaQueryOptions(adminId));
  const reset = useMutation({
    ...getResetAdminMfaMutationOptions(),
    onSuccess: () => {
      toast.success(t('mfa.admin.resetDone'));
      void status.refetch();
      invalidateResources([{ resource: Resource.PLATFORM_ADMIN, kind: 'update', id: adminId }]);
    },
    onError: showError,
  });
  return (
    <MfaAccountStatusSection
      status={status.data}
      resetting={reset.isPending}
      onReset={!canReset ? undefined : () => reset.mutateAsync({ params: { id: adminId } })}
    />
  );
}
