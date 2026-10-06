import { Module } from '@nestjs/common';

import { SettingService } from '@/core/settings';
import { ApprovalModule } from '@/modules/approval/approval.module';
import { AuthzExplainModule } from '@/modules/authz-explain/authz-explain.module';
import { TagModule } from '@/modules/tag/tag.module';
import { TrashModule } from '@/modules/trash/trash.module';
import { WebhookEventCatalog } from '@/modules/webhook/webhook-event.catalog';
import { WebhookModule } from '@/modules/webhook/webhook.module';

import { FileExternalController } from './external/file.external.controller';
import { FileExternalService } from './external/file.external.service';
import { FileAccessExplainService } from './file-access-explain.service';
import { FileAccessRequestService } from './file-access-request.service';
import { FileAccessService } from './file-access.service';
import { FileFolderAccessApprovalHandler } from './file-folder-access.approval';
import { FileFolderGrantController } from './file-folder-grant.controller';
import { FileFolderGrantRepository } from './file-folder-grant.repository';
import { FileFolderGrantService } from './file-folder-grant.service';
import { FileFolderMoveService } from './file-folder-move.service';
import { FileFolderRestoreService } from './file-folder-restore.service';
import { FileFolderTrashHandler } from './file-folder-trash.handler';
import { FileFolderTree } from './file-folder-tree';
import { FileFolderController } from './file-folder.controller';
import { FileFolderRepository } from './file-folder.repository';
import { FileFolderRules } from './file-folder.rules';
import { FileFolderService } from './file-folder.service';
import { FileImageService } from './file-image.service';
import { FileMaintenanceService } from './file-maintenance.service';
import { FileObjectsService } from './file-objects.service';
import { FileSystemFolderService } from './file-system-folder.service';
import { FileTagResource } from './file-tag.resource';
import { FileTrashHandler } from './file-trash.handler';
import { FileController } from './file.controller';
import { FileRepository } from './file.repository';
import { FileService } from './file.service';
import { FILE_SETTINGS } from './file.settings';
import { FILE_WEBHOOK_EVENTS } from './file.webhooks';

/**
 * 檔案的轉介層：對外只有 `files` 資料表的 id，物件儲存（`core/storage`）藏在後面。
 * 其他模組要引用檔案時存 `files.id`，並注入 `FileService`。
 */
@Module({
  imports: [ApprovalModule, TrashModule, AuthzExplainModule, WebhookModule, TagModule],
  // 對外 API 的 controller 也在這裡：兩個程序都註冊，另一邊的由 SurfaceGuard 回 404（docs/architecture/06-external-api.md §9.2 D11）
  controllers: [
    FileController,
    FileFolderController,
    FileFolderGrantController,
    FileExternalController,
  ],
  providers: [
    FileExternalService,
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
    FileFolderRules,
    FileFolderMoveService,
    FileFolderRestoreService,
    FileFolderRepository,
    FileFolderTree,
    FileObjectsService,
    FileTrashHandler,
    FileFolderTrashHandler,
    FileTagResource,
  ],
  exports: [FileService],
})
export class FileModule {
  constructor(settings: SettingService, webhookEvents: WebhookEventCatalog) {
    settings.register(FILE_SETTINGS);
    webhookEvents.register(FILE_WEBHOOK_EVENTS);
  }
}
