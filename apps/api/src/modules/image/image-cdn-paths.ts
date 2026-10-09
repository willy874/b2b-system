import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { CdnPathResolver } from '@/core/storage';

import { ImageAssetRepository } from './image-asset.repository';
import { assetObjectKeysOf } from './image.constants';

/**
 * 圖片資產（`imageAsset`）在手動清理時列出哪些路徑（docs/architecture/backend/09-file.md §16.11）：主檔與每個版本的每個尺寸 × 格式，
 * 與 `cli:cdn-purge --image-asset` 同一個函式（`assetObjectKeysOf`），兩邊列出的路徑一致。資產已被清除時回 404。
 */
@Injectable()
export class ImageCdnPaths implements OnModuleInit {
  constructor(
    private readonly resolver: CdnPathResolver,
    private readonly assets: ImageAssetRepository,
  ) {}

  onModuleInit(): void {
    this.resolver.register('imageAsset', (id) => this.keysOf(id));
  }

  async keysOf(id: string): Promise<string[] | null> {
    const asset = await this.assets.findById(id);
    return asset ? assetObjectKeysOf(asset) : null;
  }
}
