import { Button } from '@b2b-system/ui/Button';
import { Input } from '@b2b-system/ui/Input';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { formatBytes } from '@b2b-system/web-shared/utils';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { TagChips } from '@/core/components';
import { ResourcePanels } from '@/core/resource-panel';
import type { GalleryItemDetail } from '@/shared/api-sdk';

interface GalleryInfoPanelProps {
  item: GalleryItemDetail;
  canUpdate: boolean;
  saving: boolean;
  onSave: (patch: { title?: string; description?: string | null }) => void;
  onOpenDuplicate: (id: string) => void;
}

/** 快門速度：1 秒以下寫成 1/250。 */
function exposureLabel(seconds: number): string {
  return seconds >= 1 ? `${seconds}s` : `1/${Math.round(1 / seconds)}s`;
}

/**
 * 呼叫端以 `key`（id ＋ version）掛載：換了一張或別人改過時重新從資料開始編輯。
 *
 * 檢視器的資訊面板（docs/architecture/frontend/24-gallery.md §9）：標題與說明（可以直接編輯）、拍攝時間、相機與鏡頭、
 * 曝光參數、尺寸與大小、上傳者、來源（只是文字，不連回來源）、所在的相簿、標籤、重複的提示；下方是留言。
 */
export function GalleryInfoPanel({
  item,
  canUpdate,
  saving,
  onSave,
  onOpenDuplicate,
}: GalleryInfoPanelProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? '');
  const dirty = title.trim() !== item.title || (description.trim() || null) !== item.description;
  const exif = item.exif;
  const camera = [exif?.make, exif?.model].filter(Boolean).join(' ');
  const lens = [exif?.lensMake, exif?.lensModel].filter(Boolean).join(' ');
  const exposure = [
    exif?.fNumber ? `ƒ/${exif.fNumber}` : undefined,
    exif?.exposureTime ? exposureLabel(exif.exposureTime) : undefined,
    exif?.iso ? `ISO ${exif.iso}` : undefined,
    exif?.focalLength ? `${exif.focalLength}mm` : undefined,
    exif?.flashFired ? t('gallery.info.flash') : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  const rows: Array<{ key: string; label: string; value: ReactNode }> = [
    {
      key: 'takenAt',
      label: t('gallery.info.takenAt'),
      value: item.takenAt ? formatDateTime(item.takenAt) : t('gallery.info.noTakenAt'),
    },
    ...(camera ? [{ key: 'camera', label: t('gallery.info.camera'), value: camera }] : []),
    ...(lens ? [{ key: 'lens', label: t('gallery.info.lens'), value: lens }] : []),
    ...(exposure ? [{ key: 'exposure', label: t('gallery.info.exposure'), value: exposure }] : []),
    {
      key: 'size',
      label: t('gallery.info.dimensions'),
      value: `${item.width} × ${item.height} · ${formatBytes(item.size)}`,
    },
    { key: 'uploader', label: t('gallery.info.uploader'), value: item.uploader?.name ?? '—' },
    { key: 'createdAt', label: t('gallery.info.createdAt'), value: formatDateTime(item.createdAt) },
    {
      key: 'source',
      label: t('gallery.info.source'),
      value:
        item.source === 'upload'
          ? t('gallery.info.sourceUpload')
          : t('gallery.info.sourceAdded', { name: item.sourceName ?? '' }),
    },
    {
      key: 'albums',
      label: t('gallery.info.albums'),
      value:
        item.albums.length > 0
          ? item.albums.map((album) => album.name).join(t('gallery.info.albumsSeparator'))
          : '—',
    },
    {
      key: 'tags',
      label: t('gallery.info.tags'),
      value: <TagChips tags={item.tags} empty="—" data-testid="gallery-info-tags" />,
    },
    ...(item.locationStripped
      ? [
          {
            key: 'location',
            label: t('gallery.info.location'),
            value: t('gallery.info.locationStripped'),
          },
        ]
      : []),
  ];

  return (
    <aside
      className="flex w-full shrink-0 flex-col gap-4 overflow-auto border-t border-[var(--color-border)] p-4 text-sm md:w-80 md:border-t-0 md:border-l"
      data-testid="gallery-info-panel"
    >
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty && title.trim()) {
            onSave({ title: title.trim(), description: description.trim() || null });
          }
        }}
      >
        <Input
          value={title}
          readOnly={!canUpdate}
          maxLength={255}
          aria-label={t('gallery.info.title')}
          onChange={(event) => setTitle(event.target.value)}
          data-testid="gallery-info-title"
        />
        <Input
          value={description}
          readOnly={!canUpdate}
          maxLength={1000}
          placeholder={canUpdate ? t('gallery.info.descriptionPlaceholder') : ''}
          aria-label={t('gallery.info.description')}
          onChange={(event) => setDescription(event.target.value)}
          data-testid="gallery-info-description"
        />
        {canUpdate && dirty && (
          <Button
            type="submit"
            size="sm"
            loading={saving}
            disabled={!title.trim()}
            data-testid="gallery-info-save"
          >
            {t('common.save')}
          </Button>
        )}
      </form>
      {item.duplicates.length > 0 && (
        <p
          className="m-0 rounded-md bg-[var(--color-warning-fill)] p-2 text-[var(--color-warning-text)]"
          data-testid="gallery-info-duplicate"
        >
          {t('gallery.info.duplicate')}{' '}
          {item.duplicates.map((duplicate) => (
            <button
              key={duplicate.id}
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-[var(--color-brand)] underline"
              onClick={() => onOpenDuplicate(duplicate.id)}
            >
              {duplicate.title}
            </button>
          ))}
        </p>
      )}
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2" data-testid="gallery-info">
        {rows.map(({ key, label, value }) => (
          <div key={key} className="contents">
            <dt className="text-[var(--color-fg-muted)]">{label}</dt>
            <dd className="m-0 min-w-0 break-words" data-testid="gallery-info-row" data-value={key}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <ResourcePanels resourceType="galleryItem" resourceId={item.id} />
    </aside>
  );
}
