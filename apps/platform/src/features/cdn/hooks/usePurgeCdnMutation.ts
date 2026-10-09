import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation } from '@tanstack/react-query';

import { getPurgeCdnMutationOptions } from '@/apis/platform-cdn/purge-cdn/mutation';
import { invalidateResources, Resource } from '@/apis/resources';

/** 手動清理：排入的 `cdn.purge` 出現在「最近的清理」與背景工作列表。 */
export function usePurgeCdnMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getPurgeCdnMutationOptions(),
    onSuccess: (result) => {
      invalidateResources([
        { resource: Resource.CDN, kind: 'update' },
        { resource: Resource.PLATFORM_JOB, kind: 'create' },
      ]);
      toast.success(t('cdn.purge.queued', { count: result.jobIds.length }));
    },
  });
}
