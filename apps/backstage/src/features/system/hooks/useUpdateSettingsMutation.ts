import { useMutation } from '@tanstack/react-query';

import { invalidateResources, Resource } from '@/apis/resources';
import { getUpdateSettingsMutationOptions } from '@/apis/system/update-settings/mutation';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';

/** 修改一個分類的設定。錯誤不在這裡吞掉：欄位錯誤由表單回填，其他交給呼叫端。 */
export function useUpdateSettingsMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getUpdateSettingsMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources(
        Object.keys(params.values).map((key) => ({
          resource: Resource.SETTING,
          kind: 'update' as const,
          id: key,
        })),
      );
      toast.success(t('setting.save.success'));
    },
  });
}
