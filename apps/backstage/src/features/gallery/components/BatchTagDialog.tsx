import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Empty } from '@b2b-system/ui/Empty';
import { Select } from '@b2b-system/ui/Select';
import { useBatchQueue } from '@b2b-system/web-core/batch';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { getTagListQueryOptions } from '@/apis/tag/get-tag-list/query';

import { GALLERY_SCOPE, GalleryBatchOperation, pairedItemId } from '../batch';

interface BatchTagDialogProps {
  items: ReadonlyArray<{ id: string; title: string }>;
  onClose: () => void;
}

/** 批次貼一個標籤：每張一筆、送進全域批次佇列（取代式的 API 要先讀目前的標籤，見 `batch.ts`）。 */
export function BatchTagDialog({ items, onClose }: BatchTagDialogProps) {
  const { t } = useTranslation();
  const queue = useBatchQueue();
  const tags = useQuery(getTagListQueryOptions('gallery'));
  const [tagId, setTagId] = useState<string>();
  const options = (tags.data?.items ?? []).map((tag) => ({ value: tag.id, label: tag.name }));

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('gallery.batch.tag.dialogTitle', { count: items.length })}
      size="sm"
      data-testid="gallery-batch-tag"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!tagId || !queue}
            onClick={() => {
              if (!tagId || !queue) return;
              queue.enqueue({
                operation: GalleryBatchOperation.TAG,
                scope: GALLERY_SCOPE,
                items: items.map((item) => ({
                  id: pairedItemId(item.id, tagId),
                  label: item.title,
                })),
              });
              onClose();
            }}
            data-testid="gallery-batch-tag-submit"
          >
            {t('gallery.batch.tag.submit')}
          </Button>
        </div>
      }
    >
      {tags.isSuccess && options.length === 0 ? (
        <Empty
          title={t('gallery.batch.tag.empty')}
          description={t('gallery.batch.tag.emptyHint')}
        />
      ) : (
        <Select
          options={options}
          value={tagId ?? null}
          onValueChange={setTagId}
          searchable
          placeholder={t('gallery.filter.tag')}
          aria-label={t('gallery.filter.tag')}
          data-testid="gallery-batch-tag-select"
        />
      )}
    </Dialog>
  );
}
