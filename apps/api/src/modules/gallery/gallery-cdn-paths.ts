import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { CdnPathResolver } from '@/core/storage';

import { GalleryItemRepository } from './gallery-item.repository';
import { galleryCdnKeysOf } from './gallery.constants';

/**
 * 圖片庫的圖片（`galleryItem`）在手動清理時列出哪些路徑（docs/architecture/backend/09-file.md §16.11）：每個版本的每個尺寸 × 格式，
 * 與 `cli:cdn-purge --gallery-item` 同一個函式（`galleryCdnKeysOf`），兩邊列出的路徑一致。回收桶裡的圖片也算；永久刪除之後 404。
 */
@Injectable()
export class GalleryCdnPaths implements OnModuleInit {
  constructor(
    private readonly resolver: CdnPathResolver,
    private readonly items: GalleryItemRepository,
  ) {}

  onModuleInit(): void {
    this.resolver.register('galleryItem', (id) => this.keysOf(id));
  }

  async keysOf(id: string): Promise<string[] | null> {
    // findById 不看軟刪除：下架的需求常常發生在刪除之後
    const item = await this.items.findById(id);
    return item ? galleryCdnKeysOf(item) : null;
  }
}
