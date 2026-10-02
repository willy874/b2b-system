import { useMutation } from '@tanstack/react-query';

import { invalidateResources, Resource } from '@/apis/resources';
import { getResourceTagsReplaceMutationOptions } from '@/apis/tag/replace-resource-tags/mutation';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';

/**
 * 整批取代檔案或資料夾的標籤（docs/adr/0032-tags.md D7）：錯誤由對話框顯示，不彈 toast。
 * 檔案以 `file` update 宣告（列表與詳情重抓），資料夾以 `fileFolder` update。
 */
export function useFileTagsMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getResourceTagsReplaceMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources([
        {
          resource: params.resourceType === 'fileFolder' ? Resource.FILE_FOLDER : Resource.FILE,
          kind: 'update',
          id: params.resourceId,
        },
      ]);
      toast.success(t('tag.assign.success'));
    },
  });
}
