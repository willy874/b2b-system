import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';

import { getTagListQueryOptions } from '@/apis/tag/get-tag-list/query';
import { TagAssignDialog } from '@/core/components';
import type { GalleryItemDetail } from '@/shared/api-sdk';

import { useGalleryItemTagsMutation } from '../hooks/useGalleryMutations';

interface GalleryTagDialogProps {
  item: GalleryItemDetail;
  onClose: () => void;
}

/** 一張圖的標籤（標籤組 `gallery`，資源類型 `galleryItem`）：整批取代。 */
export function GalleryTagDialog({ item, onClose }: GalleryTagDialogProps) {
  const { t } = useTranslation();
  const options = useQuery(getTagListQueryOptions('gallery'));
  const save = useGalleryItemTagsMutation();
  return (
    <TagAssignDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('tag.assign.title', { name: item.title })}
      options={options.data?.items}
      value={item.tags}
      onSave={(tagIds) =>
        save.mutateAsync({ params: { resourceType: 'galleryItem', resourceId: item.id, tagIds } })
      }
      data-testid="gallery-tag-dialog"
    />
  );
}
