import { Module } from '@nestjs/common';

import { TagController } from './tag.controller';
import { TagRepository } from './tag.repository';
import { TagService } from './tag.service';

/**
 * 標籤（docs/adr/0032-tags.md）。只依賴 core 與 AuditLog（@Global），不 import 任何業務模組：
 * 擁有資源的模組 import 它，在 `onModuleInit` 以 `TagService.registerScope()`／`registerResource()` 登記，
 * 組回應時以 `tagsOf()` 帶上標籤，永久刪除時以 `removeAllFor()` 清理。
 */
@Module({
  controllers: [TagController],
  providers: [TagService, TagRepository],
  exports: [TagService],
})
export class TagModule {}
