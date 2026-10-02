import { useQuery } from '@tanstack/react-query';

import { getTagListQueryOptions } from '@/apis/tag/get-tag-list/query';
import { TagAssignDialog } from '@/core/components';
import { useTranslation } from '@/core/locales';

import { useFileTagsMutation } from '../../../hooks/useFileTagsMutation';
import type { BrowserItemVM } from '../adapter';

interface FileTagDialogProps {
  /** 要貼標籤的檔案或資料夾；undefined 時關閉。 */
  item: BrowserItemVM | undefined;
  onClose: () => void;
}

/** 檔案與資料夾共用 `file` 標籤組（docs/adr/0032-tags.md D1）；能不能改跟著改名的能力，後端會再檢查。 */
export function FileTagDialog({ item, onClose }: FileTagDialogProps) {
  const { t } = useTranslation();
  const options = useQuery({ ...getTagListQueryOptions('file'), enabled: Boolean(item) });
  const replace = useFileTagsMutation();
  return (
    <TagAssignDialog
      open={Boolean(item)}
      onOpenChange={(open) => !open && onClose()}
      title={t('tag.assign.title', { name: item?.name ?? '' })}
      options={options.data?.items}
      value={item?.tags ?? EMPTY}
      onSave={(tagIds) =>
        item
          ? replace.mutateAsync({
              params: {
                resourceType: item.type === 'folder' ? 'fileFolder' : 'file',
                resourceId: item.id,
                tagIds,
              },
            })
          : Promise.resolve()
      }
      data-testid="file-tag-dialog"
    />
  );
}

const EMPTY: never[] = [];
