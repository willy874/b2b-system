import { Module } from '@nestjs/common';

import { DataTransferModule } from '@/modules/data-transfer/data-transfer.module';

import { TagController } from './tag.controller';
import { TagRepository } from './tag.repository';
import { TagService } from './tag.service';
import { TagTransferResource } from './tag.transfer';

/**
 * 標籤（docs/architecture/backend/18-tag.md §7）。只依賴 core、AuditLog（@Global）與匯入匯出（通用模組），不 import 任何業務模組：
 * 擁有資源的模組 import 它，在 `onModuleInit` 以 `TagService.registerScope()`／`registerResource()` 登記，
 * 組回應時以 `tagsOf()` 帶上標籤，永久刪除時以 `removeAllFor()` 清理。
 */
@Module({
  imports: [DataTransferModule],
  controllers: [TagController],
  providers: [TagService, TagRepository, TagTransferResource],
  exports: [TagService],
})
export class TagModule {}
