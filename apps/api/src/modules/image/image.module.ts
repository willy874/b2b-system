import { Module } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { StorageSizeSources } from '@/core/usage';
import { TrashModule } from '@/modules/trash/trash.module';

import { ImageAssetRepository } from './image-asset.repository';
import { ImageAssetService } from './image-asset.service';
import { ImageMaintenanceService } from './image-maintenance.service';
import { ImageOwnerRegistry } from './image-owner.registry';
import { ImageProcessService } from './image-process.service';
import { ImageRecentSource } from './image-recent.source';
import { ImageSourceRegistry } from './image-source.registry';
import { ImageUsageRegistry } from './image-usage.registry';
import { ImageController } from './image.controller';

/**
 * 圖片資產（docs/architecture/backend/25-image.md §15）。通用模組：只依賴 core 與回收桶（保留天數），不 import 任何業務模組。
 *
 * - 使用圖片的模組（consumer）import 它，在 `onModuleInit` 以 `ImageAssetService.registerUsage()`／`registerOwner()` 登記，
 *   儲存時 `claim`／`detach`／`recrop`，組回應時 `sourcesOf()`；
 * - 能提供圖片的模組（檔案、之後的圖片庫）import 它，以 `ImageSourceRegistry.register()` 登記來源。
 */
@Module({
  imports: [TrashModule],
  controllers: [ImageController],
  providers: [
    ImageAssetRepository,
    ImageAssetService,
    ImageUsageRegistry,
    ImageSourceRegistry,
    ImageOwnerRegistry,
    ImageProcessService,
    ImageMaintenanceService,
    ImageRecentSource,
  ],
  exports: [ImageAssetService, ImageSourceRegistry],
})
export class ImageAssetModule implements OnModuleInit {
  constructor(
    private readonly sizeSources: StorageSizeSources,
    private readonly repo: ImageAssetRepository,
  ) {}

  onModuleInit(): void {
    // 主檔計入租戶的容量：檔案的對帳要把它一起加總（docs/architecture/backend/25-image.md §16.2 D3）
    this.sizeSources.register('image', (tx) => this.repo.sumSizes(tx));
  }
}
