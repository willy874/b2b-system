import { Button } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { SignedImage } from '@b2b-system/web-core/image';
import { useTranslation } from '@b2b-system/web-core/locales';
import { Link } from '@tanstack/react-router';

import type { GalleryAlbum } from '@/shared/api-sdk';

import { onGalleryImageExpired } from '../../../imageExpiry';
import { GalleryAlbumRoute, GalleryRoute } from '../../../routes';

interface GalleryAlbumBarProps {
  albums: readonly GalleryAlbum[];
  activeAlbumId: string | undefined;
  canCreate: boolean;
  onCreate: () => void;
}

/** 相簿列（docs/architecture/frontend/24-gallery.md §5）：封面、名稱、張數；相簿頁就是套了 `albumId` 的同一個列表。 */
export function GalleryAlbumBar({
  albums,
  activeAlbumId,
  canCreate,
  onCreate,
}: GalleryAlbumBarProps) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('gallery.album.label')}
      className="flex shrink-0 items-stretch gap-2 overflow-x-auto pb-1"
      data-testid="gallery-album-bar"
    >
      <Link
        to={GalleryRoute.to}
        className="flex w-28 shrink-0 flex-col gap-1 rounded-md p-1 text-sm no-underline data-[active=true]:bg-[var(--color-fill)]"
        data-active={activeAlbumId === undefined}
        data-testid="gallery-album-all"
      >
        <span className="flex aspect-[4/3] items-center justify-center rounded-md bg-[var(--color-fill-subtle)] text-[var(--color-fg-muted)]">
          <Icon name="grid" size={20} />
        </span>
        <span className="truncate text-[var(--color-fg)]">{t('gallery.album.all')}</span>
      </Link>
      {albums.map((album) => (
        <Link
          key={album.id}
          to={GalleryAlbumRoute.to}
          params={{ albumId: album.id }}
          className="flex w-28 shrink-0 flex-col gap-1 rounded-md p-1 text-sm no-underline data-[active=true]:bg-[var(--color-fill)]"
          data-active={activeAlbumId === album.id}
          data-testid="gallery-album-card"
          data-value={album.id}
        >
          <span
            className="block aspect-[4/3] overflow-hidden rounded-md bg-[var(--color-fill-subtle)]"
            // 封面的主色是資料，不是樣式（docs/architecture/backend/26-gallery.md D11）
            style={{ backgroundColor: album.coverColor ?? undefined }}
          >
            {album.cover && (
              <SignedImage
                sources={album.cover}
                variant="grid"
                sizes="112px"
                alt=""
                className="h-full w-full object-cover"
                onExpired={onGalleryImageExpired}
              />
            )}
          </span>
          <span className="truncate text-[var(--color-fg)]">{album.name}</span>
          <span className="text-xs text-[var(--color-fg-muted)]">
            {t('gallery.album.count', { count: album.itemCount })}
          </span>
        </Link>
      ))}
      {canCreate && (
        <Button
          variant="ghost"
          className="h-auto w-28 shrink-0 flex-col"
          startIcon={<Icon name="plus" size={16} />}
          onClick={onCreate}
          data-testid="gallery-album-create"
        >
          {t('gallery.album.create.action')}
        </Button>
      )}
    </nav>
  );
}
