import { useMutation } from '@tanstack/react-query';

import { getUpdateFeatureFlagMutationOptions } from '@/apis/platform-feature-flag/update-feature-flag/mutation';
import { invalidateResources, Resource } from '@/apis/resources';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';

/** 錯誤不在這裡吞掉：由確認框的呼叫端提示。 */
export function useUpdateFeatureFlagMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getUpdateFeatureFlagMutationOptions(),
    onSuccess: () => {
      invalidateResources([{ resource: Resource.FEATURE_FLAG, kind: 'update' }]);
      toast.success(t('featureFlag.update.success'));
    },
  });
}
