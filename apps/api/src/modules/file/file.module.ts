import { Module } from '@nestjs/common';

import { ApprovalModule } from '@/modules/approval/approval.module';
import { ResourceGrantModule } from '@/modules/resource-grant/resource-grant.module';

import { FileAccessRequestService } from './file-access-request.service';
import { FileAccessService } from './file-access.service';
import { FileFolderAccessApprovalHandler } from './file-folder-access.approval';
import { FileFolderGrantController } from './file-folder-grant.controller';
import { FileFolderGrantService } from './file-folder-grant.service';
import { FileFolderController } from './file-folder.controller';
import { FileFolderRepository } from './file-folder.repository';
import { FileFolderService } from './file-folder.service';
import { FileImageService } from './file-image.service';
import { FileMaintenanceService } from './file-maintenance.service';
import { FileSystemFolderService } from './file-system-folder.service';
import { FileController } from './file.controller';
import { FileRepository } from './file.repository';
import { FileService } from './file.service';

/**
 * 檔案的轉介層：對外只有 `files` 資料表的 id，物件儲存（`core/storage`）藏在後面。
 * 其他模組要引用檔案時存 `files.id`，並注入 `FileService`。
 */
@Module({
  imports: [ResourceGrantModule, ApprovalModule],
  controllers: [FileController, FileFolderController, FileFolderGrantController],
  providers: [
    FileAccessService,
    FileAccessRequestService,
    FileSystemFolderService,
    FileFolderAccessApprovalHandler,
    FileFolderGrantService,
    FileService,
    FileImageService,
    FileMaintenanceService,
    FileRepository,
    FileFolderService,
    FileFolderRepository,
  ],
  exports: [FileService],
})
export class FileModule {}
