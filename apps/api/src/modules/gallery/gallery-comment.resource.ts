import { ChangeSource } from '@b2b-system/realtime';
import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { PERMISSION } from '@/common/types';
import { RESOURCE_TYPE } from '@/core/resource';
import type { GalleryItemRow } from '@/db/schema';
import { CommentService } from '@/modules/comment/comment.service';
import type { CommentTarget } from '@/modules/comment/comment.types';
import { PermissionService } from '@/modules/permission/permission.service';

import { GalleryItemService } from './gallery-item.service';

function targetOf(item: GalleryItemRow): CommentTarget {
  // 圖片庫的檢視器（前端 `gallery.item`，docs/architecture/backend/15-notification.md §4.1）
  return { name: item.title, link: { route: 'gallery.item', params: { itemId: item.id } } };
}

/**
 * 圖片庫的圖片可以留言與關注（docs/architecture/backend/24-comment.md §1）：看得到圖片庫（`gallery:read`）就能讀與寫留言、關注。
 * 整個圖片庫對 `gallery:read` 的人都可見（D4），沒有逐張的授權。
 */
@Injectable()
export class GalleryCommentResource implements OnModuleInit {
  constructor(
    private readonly comments: CommentService,
    private readonly items: GalleryItemService,
    private readonly permissions: PermissionService,
  ) {}

  onModuleInit(): void {
    this.comments.registerResource({
      resourceType: RESOURCE_TYPE.GALLERY_ITEM,
      changeSource: ChangeSource.GALLERY_ITEM,
      feature: 'gallery',
      resolveViewable: async (actor, id, context) => {
        await this.permissions.assertHasAll(actor, [PERMISSION.GALLERY_READ], context);
        return targetOf(await this.items.getVisible(id));
      },
      describe: async (id) => {
        const item = await this.items.findVisible(id);
        return item && targetOf(item);
      },
      filterViewers: async (_id, userIds) => {
        const sets = await this.permissions.getPermissionSets(userIds);
        return userIds.filter((userId) => {
          const set = sets.get(userId);
          return (
            set !== undefined && (set.isSuperAdmin || set.permissions.has(PERMISSION.GALLERY_READ))
          );
        });
      },
    });
  }
}
