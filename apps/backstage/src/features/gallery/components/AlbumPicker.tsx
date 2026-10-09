import { Input } from '@b2b-system/ui/Input';
import { Select } from '@b2b-system/ui/Select';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';

import { getGalleryAlbumsQueryOptions } from '@/apis/gallery/get-gallery-albums/query';

/** 相簿的選擇：不加入、既有的相簿、或新建一個（`name`）。 */
export type AlbumChoice =
  | { kind: 'none' }
  | { kind: 'existing'; albumId: string }
  | { kind: 'new'; name: string };

const NONE = '__none__';
const NEW = '__new__';

interface AlbumPickerProps {
  value: AlbumChoice;
  onChange: (value: AlbumChoice) => void;
  /** 能不能新建相簿（`gallery:create`）。 */
  canCreate: boolean;
  /** 「不加入相簿」的選項；加入相簿的對話框不需要。 */
  allowNone?: boolean;
  disabled?: boolean;
}

/** 加入圖片庫、上傳、加入相簿共用的相簿選擇（docs/architecture/frontend/24-gallery.md §5）。 */
export function AlbumPicker({
  value,
  onChange,
  canCreate,
  allowNone = true,
  disabled,
}: AlbumPickerProps) {
  const { t } = useTranslation();
  const albums = useQuery(getGalleryAlbumsQueryOptions());
  let selected: string | null = allowNone ? NONE : null;
  if (value.kind === 'existing') selected = value.albumId;
  if (value.kind === 'new') selected = NEW;
  return (
    <div className="flex flex-col gap-2" data-testid="gallery-album-picker">
      <Select
        options={[
          ...(allowNone ? [{ value: NONE, label: t('gallery.album.none') }] : []),
          ...(albums.data?.items ?? []).map((album) => ({ value: album.id, label: album.name })),
          ...(canCreate ? [{ value: NEW, label: t('gallery.album.createNew') }] : []),
        ]}
        value={selected}
        placeholder={t('gallery.album.choose')}
        disabled={disabled}
        searchable
        searchPlaceholder={t('gallery.album.search')}
        onValueChange={(next) => {
          if (next === NONE) onChange({ kind: 'none' });
          else if (next === NEW) onChange({ kind: 'new', name: '' });
          else onChange({ kind: 'existing', albumId: next });
        }}
        aria-label={t('gallery.album.label')}
        data-testid="gallery-album-picker-select"
      />
      {value.kind === 'new' && (
        <Input
          value={value.name}
          maxLength={100}
          disabled={disabled}
          placeholder={t('gallery.album.namePlaceholder')}
          aria-label={t('gallery.album.name')}
          onChange={(event) => onChange({ kind: 'new', name: event.target.value })}
          data-testid="gallery-album-picker-name"
        />
      )}
    </div>
  );
}

/** 送出前：新建的相簿名稱不能是空的。 */
export function isAlbumChoiceValid(choice: AlbumChoice): boolean {
  return choice.kind !== 'new' || choice.name.trim().length > 0;
}
