import { useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { MfaAccountStatusSection } from '@b2b-system/web-core/mfa';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation, useQuery } from '@tanstack/react-query';

import { invalidateResources, Resource } from '@/apis/resources';
import { getUserMfaQueryOptions } from '@/apis/user/get-user-mfa/query';
import { getResetUserMfaMutationOptions } from '@/apis/user/reset-user-mfa/mutation';

interface UserMfaSectionProps {
  userId: string;
  /** `user:update` 且不是自己（自己的在個人資料頁管理）；持有 super-admin 的對象還要操作者也是 super-admin（後端判斷）。 */
  canReset: boolean;
}

/** 使用者的驗證方式與「重設 MFA」（docs/architecture/backend/21-mfa.md §8）：重設會登出對方所有的裝置。 */
export function UserMfaSection({ userId, canReset }: UserMfaSectionProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const showError = useErrorToast();
  const status = useQuery(getUserMfaQueryOptions(userId));
  const reset = useMutation({
    ...getResetUserMfaMutationOptions(),
    onSuccess: () => {
      toast.success(t('mfa.admin.resetDone'));
      void status.refetch();
      invalidateResources([{ resource: Resource.USER, kind: 'update', id: userId }]);
    },
    onError: showError,
  });
  return (
    <MfaAccountStatusSection
      status={status.data}
      resetting={reset.isPending}
      onReset={canReset ? () => reset.mutateAsync({ params: { id: userId } }) : undefined}
    />
  );
}
