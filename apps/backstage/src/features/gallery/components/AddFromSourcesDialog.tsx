import { MultiImageSourceDialog, useImageUsage } from '@b2b-system/web-core/image-picker';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';

import { GALLERY_FROM_SOURCE_MAX, GALLERY_IMAGE_USAGE } from '../constants';
import { useGalleryFromSourceMutation } from '../hooks/useGalleryMutations';
import { GALLERY_IMAGE_SOURCE_ID } from '../imageSource/register';

interface AddFromSourcesDialogProps {
  /** 加入後一併放進這個相簿（在相簿頁打開時）。 */
  albumId?: string;
  onClose: () => void;
}

/**
 * 圖片庫的「從其他來源加入」（docs/architecture/frontend/24-gallery.md §6）：打開 `web-core/image-picker` 的多選對話框，
 * 列出其他來源（排除上傳、最近使用、圖片庫自己）。圖片庫不知道裡面有哪些來源；結果與檔案管理器的「加入圖片庫」相同。
 */
export function AddFromSourcesDialog({ albumId, onClose }: AddFromSourcesDialogProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const usage = useImageUsage(GALLERY_IMAGE_USAGE);
  const add = useGalleryFromSourceMutation();
  if (!usage) return null;
  return (
    <MultiImageSourceDialog
      usage={usage}
      exclude={[GALLERY_IMAGE_SOURCE_ID]}
      title={t('gallery.addFromSource.title')}
      confirmLabel={(count) => t('gallery.addFromSource.submit', { count })}
      max={GALLERY_FROM_SOURCE_MAX}
      onConfirm={async ({ source, items }) => {
        const result = await add.mutateAsync({
          params: { body: { source, refIds: items.map((item) => item.refId), albumId } },
        });
        const added = result.results.filter((entry) => entry.status === 'added').length;
        const skipped = result.results.length - added;
        toast.success(t('gallery.addFromSource.result', { added, skipped }));
        onClose();
      }}
      onClose={onClose}
    />
  );
}
