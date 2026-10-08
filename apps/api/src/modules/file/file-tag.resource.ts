import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { PERMISSION } from '@/common/types';
import { RESOURCE_TYPE } from '@/core/resource';
import { PermissionService } from '@/modules/permission/permission.service';
import { TagService } from '@/modules/tag/tag.service';

import { FileFolderService } from './file-folder.service';
import { FileService } from './file.service';

/** 檔案管理器的標籤組：檔案與資料夾共用一組（docs/architecture/backend/18-tag.md §7.2 D1）。 */
export const FILE_TAG_SCOPE = 'file';

/**
 * 檔案與資料夾可以貼標籤（docs/architecture/backend/18-tag.md §7.2 D5、D7）：讀定義要進得了檔案管理器（`file:access` 或 `file:read`），
 * 貼與移除跟改名同一個判斷。屬於可啟用的 feature `file`（D12）。
 */
@Injectable()
export class FileTagResource implements OnModuleInit {
  constructor(
    private readonly tags: TagService,
    private readonly files: FileService,
    private readonly folders: FileFolderService,
    private readonly permissions: PermissionService,
  ) {}

  onModuleInit(): void {
    this.tags.registerScope({
      scope: FILE_TAG_SCOPE,
      feature: 'file',
      label: { 'zh-TW': '檔案', 'en-US': 'Files' },
      assertCanBrowse: (actor, context) =>
        this.permissions.assertHasAny(
          actor,
          [PERMISSION.FILE_ACCESS, PERMISSION.FILE_READ],
          context,
        ),
    });
    this.tags.registerResource({
      resourceType: RESOURCE_TYPE.FILE,
      scope: FILE_TAG_SCOPE,
      resolveEditable: (actor, id) => this.files.assertTaggable(id, actor),
      afterTagsChanged: (id) => this.files.publishTagsChanged(id),
    });
    this.tags.registerResource({
      resourceType: RESOURCE_TYPE.FILE_FOLDER,
      scope: FILE_TAG_SCOPE,
      resolveEditable: (actor, id) => this.folders.assertTaggable(id, actor),
      afterTagsChanged: (id) => this.folders.publishTagsChanged(id),
    });
  }
}
