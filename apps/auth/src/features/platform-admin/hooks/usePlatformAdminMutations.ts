import { useMutation } from '@tanstack/react-query';

import { getCreateAdminMutationOptions } from '@/apis/platform-admin/create-admin/mutation';
import { getSendAdminPasswordLinkMutationOptions } from '@/apis/platform-admin/send-admin-password-link/mutation';
import { getUpdateAdminMutationOptions } from '@/apis/platform-admin/update-admin/mutation';
import { invalidateResources, Resource } from '@/apis/resources';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';
import type { PlatformAdminPasswordLink } from '@/shared/api-sdk';
import type { PlatformAdmin } from '@/shared/api-sdk';

import { PASSWORD_LINK_SUCCESS_KEY } from '../constants';

type ChangeKind = 'create' | 'update';

/** 寫入成功：失效平台管理者清單並提示。錯誤不在這裡吞掉，由呼叫端顯示。 */
function usePlatformAdminChange(kind: ChangeKind, messageKey: string) {
  const toast = useToast();
  const { t } = useTranslation();
  return (id: string) => {
    invalidateResources([{ resource: Resource.PLATFORM_ADMIN, kind, id }]);
    toast.success(t(messageKey));
  };
}

export function useCreatePlatformAdminMutation() {
  const changed = usePlatformAdminChange('create', 'platformAdmin.create.success');
  return useMutation({
    ...getCreateAdminMutationOptions(),
    onSuccess: (admin: PlatformAdmin) => changed(admin.id),
  });
}

export function useUpdatePlatformAdminMutation() {
  const changed = usePlatformAdminChange('update', 'platformAdmin.edit.success');
  return useMutation({
    ...getUpdateAdminMutationOptions(),
    onSuccess: (admin: PlatformAdmin) => changed(admin.id),
  });
}

/** 寄設定密碼的連結：只寄信、不改資料，所以不失效；提示依寄出的信種類不同。 */
export function useSendPlatformAdminPasswordLinkMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getSendAdminPasswordLinkMutationOptions(),
    onSuccess: ({ purpose }: PlatformAdminPasswordLink) =>
      toast.success(t(PASSWORD_LINK_SUCCESS_KEY[purpose])),
  });
}
