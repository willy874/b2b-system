import { Module } from '@nestjs/common';

import { SettingService } from '@/core/settings';
import { NotificationEventCatalog } from '@/modules/notification/notification-event.catalog';
import { NotificationModule } from '@/modules/notification/notification.module';

import { DataTransferCleanupService } from './data-transfer-cleanup.service';
import { DataTransferRegistry } from './data-transfer-registry.service';
import { DataTransferContextFactory } from './data-transfer.context';
import { DataTransferController } from './data-transfer.controller';
import { ImportUploadInterceptor } from './data-transfer.http';
import { DataTransferJobs } from './data-transfer.jobs';
import { DataTransferLifecycle } from './data-transfer.lifecycle';
import { DATA_TRANSFER_NOTIFICATIONS } from './data-transfer.notifications';
import { DataTransferRepository } from './data-transfer.repository';
import { DataTransferService } from './data-transfer.service';
import { DATA_TRANSFER_SETTINGS } from './data-transfer.settings';
import { DataTransferExportService } from './export/data-transfer-export.service';
import { DataTransferApplyService } from './import/data-transfer-apply.service';
import { DataTransferImportService } from './import/data-transfer-import.service';
import { ImportValidator } from './import/import-validator';
import { ParsePool } from './import/parse-pool';
import { AuditLogTransferResource } from './resources/audit-log.transfer';

/**
 * 匯入／匯出（docs/architecture/backend/22-data-transfer.md）。只依賴 core、通知與全域的葉節點模組（權限、稽核），
 * 不 import 任何業務模組：擁有資源的模組 import 它，在 `onModuleInit` 以 `DataTransferRegistry.register()` 登記
 * 欄位定義、exporter 與 importer（§5.1）。
 */
@Module({
  imports: [NotificationModule],
  controllers: [DataTransferController],
  providers: [
    DataTransferRegistry,
    DataTransferRepository,
    DataTransferContextFactory,
    DataTransferLifecycle,
    DataTransferService,
    DataTransferImportService,
    DataTransferExportService,
    DataTransferApplyService,
    DataTransferCleanupService,
    DataTransferJobs,
    ImportValidator,
    ImportUploadInterceptor,
    ParsePool,
    AuditLogTransferResource,
  ],
  exports: [DataTransferRegistry],
})
export class DataTransferModule {
  constructor(notificationEvents: NotificationEventCatalog, settings: SettingService) {
    notificationEvents.register(DATA_TRANSFER_NOTIFICATIONS);
    settings.register(DATA_TRANSFER_SETTINGS);
  }
}
