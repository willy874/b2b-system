import { Module } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { SettingService } from '@/core/settings';
import { TenantFeatureImpacts } from '@/core/tenant';
import { StorageSizeSources } from '@/core/usage';
import { CommentModule } from '@/modules/comment/comment.module';
import { ImageAssetModule } from '@/modules/image/image.module';
import { TagModule } from '@/modules/tag/tag.module';
import { TrashModule } from '@/modules/trash/trash.module';

import { GalleryAlbumController } from './gallery-album.controller';
import { GalleryAlbumRepository } from './gallery-album.repository';
import { GalleryAlbumService } from './gallery-album.service';
import { GalleryCommentResource } from './gallery-comment.resource';
import { GalleryImageUrls } from './gallery-image-urls';
import { GalleryImageSource } from './gallery-image.source';
import { GalleryItemController } from './gallery-item.controller';
import { GalleryItemRepository } from './gallery-item.repository';
import { GalleryItemService } from './gallery-item.service';
import { GalleryMaintenanceService } from './gallery-maintenance.service';
import { GalleryProcessService } from './gallery-process.service';
import { GalleryTagResource } from './gallery-tag.resource';
import { GalleryAlbumTrashHandler, GalleryItemTrashHandler } from './gallery-trash.handlers';
import { GALLERY_SETTINGS } from './gallery.settings';

/**
 * 圖片庫（docs/architecture/backend/26-gallery.md）。與檔案管理平行、互不認識（D0）：
 * 經 `modules/image` 的 `ImageSourceRegistry` 讀其他來源、也登記成來源 `'gallery'`；不 import `modules/file`。
 * 可由平台關閉（`gallery`）；背景工作在停用時照常完成（資料要一致）。
 */
@Module({
  imports: [TrashModule, TagModule, CommentModule, ImageAssetModule],
  controllers: [GalleryItemController, GalleryAlbumController],
  providers: [
    GalleryItemRepository,
    GalleryAlbumRepository,
    GalleryImageUrls,
    GalleryItemService,
    GalleryAlbumService,
    GalleryProcessService,
    GalleryMaintenanceService,
    GalleryImageSource,
    GalleryTagResource,
    GalleryCommentResource,
    GalleryItemTrashHandler,
    GalleryAlbumTrashHandler,
  ],
})
export class GalleryModule implements OnModuleInit {
  constructor(
    settings: SettingService,
    private readonly impacts: TenantFeatureImpacts,
    private readonly sizeSources: StorageSizeSources,
    private readonly items: GalleryItemRepository,
    private readonly albums: GalleryAlbumRepository,
  ) {
    settings.register(GALLERY_SETTINGS);
  }

  onModuleInit(): void {
    // 原檔計入租戶的容量：`file.maintenance` 對帳時一起加總（與檔案、圖片資產共用 `file.storageQuotaMb`）
    this.sizeSources.register('gallery', (tx) => this.items.sumSizes(tx));
    // 平台關閉 `gallery` 前的確認框列出的數量
    this.impacts.register('gallery', async () => ({
      galleryItems: await this.items.countVisible(),
      galleryAlbums: await this.albums.countActive(),
    }));
  }
}
