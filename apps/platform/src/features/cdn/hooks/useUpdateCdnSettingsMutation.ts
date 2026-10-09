import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation } from '@tanstack/react-query';

import { getUpdateCdnSettingsMutationOptions } from '@/apis/platform-cdn/update-cdn-settings/mutation';
import { invalidateResources, Resource } from '@/apis/resources';

/**
 * 改設定。錯誤不在這裡吞掉：`CDN_NOT_READY` 由頁面在開關旁顯示節點的問題，其他交給呼叫端提示。
 * 版本衝突時也重抓（別人改過，畫面上的值已經舊了）。
 */
export function useUpdateCdnSettingsMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getUpdateCdnSettingsMutationOptions(),
    onSuccess: () => {
      invalidateResources([{ resource: Resource.CDN, kind: 'update' }]);
      toast.success(t('cdn.settings.saved'));
    },
    onError: () => invalidateResources([{ resource: Resource.CDN, kind: 'update' }]),
  });
}
