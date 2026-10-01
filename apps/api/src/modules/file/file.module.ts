import { Module } from '@nestjs/common';

import { SettingService } from '@/core/settings';
import { ApprovalModule } from '@/modules/approval/approval.module';
import { AuthzExplainModule } from '@/modules/authz-explain/authz-explain.module';
import { TrashModule } from '@/modules/trash/trash.module';

import { FileAccessExplainService } from './file-access-explain.service';
import { FileAccessRequestService } from './file-access-request.service';
import { FileAccessService } from './file-access.service';
import { FileFolderAccessApprovalHandler } from './file-folder-access.approval';
import { FileFolderGrantController } from './file-folder-grant.controller';
import { FileFolderGrantRepository } from './file-folder-grant.repository';
import { FileFolderGrantService } from './file-folder-grant.service';
import { FileFolderTrashHandler } from './file-folder-trash.handler';
import { FileFolderTree } from './file-folder-tree';
import { FileFolderController } from './file-folder.controller';
import { FileFolderRepository } from './file-folder.repository';
import { FileFolderService } from './file-folder.service';
import { FileImageService } from './file-image.service';
import { FileMaintenanceService } from './file-maintenance.service';
import { FileObjectsService } from './file-objects.service';
import { FileSystemFolderService } from './file-system-folder.service';
import { FileTrashHandler } from './file-trash.handler';
import { FileController } from './file.controller';
import { FileRepository } from './file.repository';
import { FileService } from './file.service';
import { FILE_SETTINGS } from './file.settings';

/**
 * 檔案的轉介層：對外只有 `files` 資料表的 id，物件儲存（`core/storage`）藏在後面。
 * 其他模組要引用檔案時存 `files.id`，並注入 `FileService`。
 */
@Module({
  imports: [ApprovalModule, TrashModule, AuthzExplainModule],
  controllers: [FileController, FileFolderController, FileFolderGrantController],
  providers: [
    FileAccessService,
    FileAccessExplainService,
    FileAccessRequestService,
    FileSystemFolderService,
    FileFolderAccessApprovalHandler,
    FileFolderGrantService,
    FileFolderGrantRepository,
    FileService,
    FileImageService,
    FileMaintenanceService,
    FileRepository,
    FileFolderService,
    FileFolderRepository,
    FileFolderTree,
    FileObjectsService,
    FileTrashHandler,
    FileFolderTrashHandler,
  ],
  exports: [FileService],
})
export class FileModule {
  constructor(settings: SettingService) {
    settings.register(FILE_SETTINGS);
  }
}
