import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation } from '@tanstack/react-query';

import { getRetryJobMutationOptions } from '@/apis/job/retry-job/mutation';
import { invalidateResources, Resource } from '@/apis/resources';

/** 錯誤不在這裡吞掉：由確認框的呼叫端提示（例：JOB_NOT_RETRYABLE 代表別人已經重試過）。 */
export function useRetryJobMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getRetryJobMutationOptions(),
    onSuccess: (job) => {
      invalidateResources([{ resource: Resource.JOB, kind: 'update', id: job.id }]);
      toast.success(t('job.retry.success'));
    },
  });
}
