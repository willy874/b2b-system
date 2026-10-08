import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { PERMISSION } from '@/common/types';
import { AppException } from '@/core/errors';
import { RESOURCE_TYPE } from '@/core/resource';
import { PermissionService } from '@/modules/permission/permission.service';
import { TagService } from '@/modules/tag/tag.service';

import { UserRepository } from './user.repository';
import { UserService } from './user.service';

/** 使用者的標籤組（docs/architecture/backend/18-tag.md §7.2 D1）。 */
export const USER_TAG_SCOPE = 'user';

/**
 * 使用者可以貼標籤（docs/architecture/backend/18-tag.md §7.2 D5、D7）：讀定義要 `user:read`（看得到使用者列表），
 * 貼與移除要 `user:update`。服務帳號不在使用者列表，不能貼。
 */
@Injectable()
export class UserTagResource implements OnModuleInit {
  constructor(
    private readonly tags: TagService,
    private readonly repo: UserRepository,
    private readonly users: UserService,
    private readonly permissions: PermissionService,
  ) {}

  onModuleInit(): void {
    this.tags.registerScope({
      scope: USER_TAG_SCOPE,
      label: { 'zh-TW': '使用者', 'en-US': 'Users' },
      assertCanBrowse: (actor, context) =>
        this.permissions.assertHasAll(actor, [PERMISSION.USER_READ], context),
    });
    this.tags.registerResource({
      resourceType: RESOURCE_TYPE.USER,
      scope: USER_TAG_SCOPE,
      resolveEditable: async (actor, id, context) => {
        const user = await this.repo.findById(id);
        if (!user) throw new AppException('USER_NOT_FOUND');
        await this.permissions.assertHasAll(actor, [PERMISSION.USER_UPDATE], context);
        return { name: user.email };
      },
      afterTagsChanged: (id) => this.users.publishTagsChanged(id),
    });
  }
}
