import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { PERMISSION } from '@/common/types';
import { AppException } from '@/core/errors';
import { IMAGE_FORMAT_CONTENT_TYPE, renditionKey } from '@/core/image';
import type { ImageFormat } from '@/core/image';
import { RESOURCE_TYPE } from '@/core/resource';
import { ObjectStorage } from '@/core/storage';
import type { GalleryItemRow } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';
import { ImageAssetService } from '@/modules/image/image-asset.service';
import { ImageSourceRegistry } from '@/modules/image/image-source.registry';
import { PermissionService } from '@/modules/permission/permission.service';

import { GalleryItemService } from './gallery-item.service';
import {
  GALLERY_CONTENT_TYPES,
  GALLERY_IMAGE_SOURCE,
  GALLERY_IMAGE_USAGE,
  GALLERY_RENDITIONS,
  GALLERY_URL_TTL,
  originalKeyOf,
  revPrefixOf,
} from './gallery.constants';

/** 「從其他來源加入」的過濾用途的大小上限：feature 參數 `gallery.maxItemSizeMb` 的最大值（每個租戶的上限在加入時再檢查）。 */
const FILTER_MAX_SIZE = 200 * 1024 * 1024;

/**
 * 圖片庫與圖片的通用層（docs/architecture/backend/26-gallery.md §9、D0、D1）：
 *
 * - 登記成圖片來源 `'gallery'`：選圖（頭像等）時從圖片庫挑圖，以呼叫者的身分讀取（要 `gallery:read`），
 *   呼叫端把原檔（已依 D5 移除位置資訊的那份）**複製** 成自己的一份——之後圖片庫刪圖、改圖都不影響它；
 * - 登記一個只用來過濾的用途 `gallery.item`：「從其他來源加入」時，其他來源（檔案管理）以它濾出圖片庫收得下的圖。
 *   它不能建立圖片資產（`filterOnly`）。
 */
@Injectable()
export class GalleryImageSource implements OnModuleInit {
  constructor(
    private readonly sources: ImageSourceRegistry,
    private readonly images: ImageAssetService,
    private readonly items: GalleryItemService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly storage: ObjectStorage,
  ) {}

  onModuleInit(): void {
    this.images.registerUsage({
      id: GALLERY_IMAGE_USAGE,
      maxSize: FILTER_MAX_SIZE,
      contentTypes: GALLERY_CONTENT_TYPES,
      minWidth: 1,
      minHeight: 1,
      presets: { thumb: GALLERY_RENDITIONS.thumb },
      urlTtl: GALLERY_URL_TTL,
      visibility: 'signed',
      filterOnly: true,
    });
    this.sources.register({
      id: GALLERY_IMAGE_SOURCE,
      feature: 'gallery',
      resolve: async (refId, actor, purpose) => {
        await this.permissions.assertHasAll(actor, [PERMISSION.GALLERY_READ], {
          route: 'POST /images/from-source',
          metadata: { source: GALLERY_IMAGE_SOURCE, refId },
        });
        const item = await this.items.getVisible(refId);
        await this.audit.record({
          action: 'galleryItem.copy',
          resourceType: RESOURCE_TYPE.GALLERY_ITEM,
          resourceId: item.id,
          resourceName: item.title,
          changes: { after: { purpose } },
        });
        return this.copySourceOf(item);
      },
    });
  }

  /**
   * 複製哪一個物件：原檔（已依 D5 移除位置資訊）；調整過顯示方向時原檔沒有轉，改用 `large` 的變體
   * （已轉好、長邊 2560、沒有中繼資料），選到的圖才會與圖片庫裡看到的方向一致。
   */
  private async copySourceOf(item: GalleryItemRow) {
    if (item.displayRotation === 0 || !item.variants || item.variantRev === null) {
      return {
        storageKey: originalKeyOf(item.id),
        contentType: item.contentType,
        size: item.size,
        name: item.title,
        width: item.width ?? undefined,
        height: item.height ?? undefined,
      };
    }
    const format = (item.variants.formats[0] ?? 'jpeg') as ImageFormat;
    const large = item.variants.renditions.large;
    const name = large?.sameAs ?? 'large';
    const target = item.variants.renditions[name] ?? large;
    const key = renditionKey(revPrefixOf(item.id, item.variantRev), name, format);
    const stored = await this.storage.head(key);
    if (!stored) throw new AppException('GALLERY_ITEM_NOT_FOUND');
    return {
      storageKey: key,
      contentType: IMAGE_FORMAT_CONTENT_TYPE[format],
      size: stored.size,
      name: item.title,
      width: target?.width,
      height: target?.height,
    };
  }
}
