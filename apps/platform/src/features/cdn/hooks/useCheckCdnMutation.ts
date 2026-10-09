import { useMutation } from '@tanstack/react-query';

import { getCheckCdnMutationOptions } from '@/apis/platform-cdn/check-cdn/mutation';
import { invalidateResources, Resource } from '@/apis/resources';

/** 執行檢查：結果寫進 `last_check`，重抓頁面。 */
export function useCheckCdnMutation() {
  return useMutation({
    ...getCheckCdnMutationOptions(),
    onSuccess: () => invalidateResources([{ resource: Resource.CDN, kind: 'update' }]),
  });
}
