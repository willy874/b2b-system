import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { PERMISSION } from '@/common/types';
import { RESOURCE_TYPE } from '@/core/resource';
import { PermissionService } from '@/modules/permission/permission.service';
import { TagService } from '@/modules/tag/tag.service';

import { GalleryItemService } from './gallery-item.service';
import { GALLERY_TAG_SCOPE } from './gallery.constants';

/**
 * 圖片庫的圖片可以貼標籤（docs/architecture/backend/18-tag.md §1.1）：標籤組 `gallery`、資源類型 `galleryItem`。
 * 讀定義要 `gallery:read`；貼與移除要 `gallery:update`（與編輯標題同一個權限）。屬於可關閉的 feature `gallery`。
 */
@Injectable()
export class GalleryTagResource implements OnModuleInit {
  constructor(
    private readonly tags: TagService,
    private readonly items: GalleryItemService,
    private readonly permissions: PermissionService,
  ) {}

  onModuleInit(): void {
    this.tags.registerScope({
      scope: GALLERY_TAG_SCOPE,
      feature: 'gallery',
      label: { 'zh-TW': '圖片庫', 'en-US': 'Gallery' },
      assertCanBrowse: (actor, context) =>
        this.permissions.assertHasAll(actor, [PERMISSION.GALLERY_READ], context),
    });
    this.tags.registerResource({
      resourceType: RESOURCE_TYPE.GALLERY_ITEM,
      scope: GALLERY_TAG_SCOPE,
      resolveEditable: async (actor, id, context) => {
        await this.permissions.assertHasAll(actor, [PERMISSION.GALLERY_UPDATE], context);
        const item = await this.items.getVisible(id);
        return { name: item.title };
      },
      afterTagsChanged: (id) => this.items.publishChanged(id),
    });
  }
}
