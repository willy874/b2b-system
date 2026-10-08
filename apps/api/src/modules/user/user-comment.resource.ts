import { ChangeSource } from '@b2b-system/realtime';
import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { PERMISSION } from '@/common/types';
import { AppException } from '@/core/errors';
import { RESOURCE_TYPE } from '@/core/resource';
import type { UserRow } from '@/db/schema';
import { CommentService } from '@/modules/comment/comment.service';
import type { CommentTarget } from '@/modules/comment/comment.types';
import { PermissionService } from '@/modules/permission/permission.service';

import { UserRepository } from './user.repository';

function targetOf(user: UserRow): CommentTarget {
  return {
    name: user.displayName,
    // 使用者詳情（前端 `user.detail`，docs/architecture/backend/15-notification.md §4.1）
    link: { route: 'user.detail', params: { userId: user.id } },
  };
}

/**
 * 使用者可以留言與關注（docs/architecture/backend/24-comment.md §1）：看得到使用者詳情（`user:read`）就能讀與寫留言、關注。
 * 服務帳號不在使用者列表，不能留言。
 */
@Injectable()
export class UserCommentResource implements OnModuleInit {
  constructor(
    private readonly comments: CommentService,
    private readonly repo: UserRepository,
    private readonly permissions: PermissionService,
  ) {}

  onModuleInit(): void {
    this.comments.registerResource({
      resourceType: RESOURCE_TYPE.USER,
      changeSource: ChangeSource.USER,
      resolveViewable: async (actor, id, context) => {
        await this.permissions.assertHasAll(actor, [PERMISSION.USER_READ], context);
        const user = await this.repo.findById(id);
        if (!user) throw new AppException('USER_NOT_FOUND');
        return targetOf(user);
      },
      describe: async (id) => {
        const user = await this.repo.findById(id);
        return user && targetOf(user);
      },
      filterViewers: async (_id, userIds) => {
        const sets = await this.permissions.getPermissionSets(userIds);
        return userIds.filter((userId) => {
          const set = sets.get(userId);
          return (
            set !== undefined && (set.isSuperAdmin || set.permissions.has(PERMISSION.USER_READ))
          );
        });
      },
    });
  }
}
