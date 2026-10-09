import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { AppException } from '@/core/errors';
import type { ImageFormat } from '@/core/image';

import { ImageAssetRepository } from './image-asset.repository';
import { ImageSourceRegistry } from './image-source.registry';
import type { ResolvedImage } from './image-source.registry';
import { IMAGE_SOURCE, masterKeyOf } from './image.constants';

/**
 * 內建的來源「最近使用」（docs/architecture/backend/25-image.md §15.7）：自己建立過的圖片資產的主檔。
 * 只檢查 `created_by = 自己`——從檔案管理複製來的副本，失去那個資料夾的權限之後仍可再用（docs/architecture/backend/25-image.md §16.2 D10）。
 * 解析出的是已經正規化過的主檔：新的資產直接沿用，不再重新編碼（內容雜湊相同，「最近使用」只列一次）。
 */
@Injectable()
export class ImageRecentSource implements OnModuleInit {
  constructor(
    private readonly sources: ImageSourceRegistry,
    private readonly repo: ImageAssetRepository,
  ) {}

  onModuleInit(): void {
    this.sources.register({
      id: IMAGE_SOURCE.RECENT,
      resolve: (refId, actor) => this.resolve(refId, actor),
    });
  }

  async resolve(refId: string, actor: AuthUser): Promise<ResolvedImage> {
    const row = /^[0-9a-f-]{36}$/i.test(refId) ? await this.repo.findById(refId) : undefined;
    const { masterFormat, width, height } = row ?? {};
    if (
      !row ||
      row.createdBy !== actor.id ||
      row.status !== 'ready' ||
      !masterFormat ||
      !width ||
      !height
    ) {
      throw new AppException('IMAGE_ASSET_NOT_FOUND');
    }
    const format = masterFormat as ImageFormat;
    return {
      storageKey: masterKeyOf(row.id, format),
      contentType: row.contentType,
      size: row.size,
      name: row.sourceName,
      width,
      height,
      normalized: {
        width,
        height,
        hasAlpha: row.hasAlpha ?? false,
        format,
        contentHash: row.contentHash,
      },
    };
  }
}
