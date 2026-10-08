import { Module } from '@nestjs/common';

import { NotificationEventCatalog } from '@/modules/notification/notification-event.catalog';
import { NotificationModule } from '@/modules/notification/notification.module';

import { CommentController } from './comment.controller';
import { COMMENT_NOTIFICATIONS } from './comment.notifications';
import { CommentResourceRegistry } from './comment.registry';
import { CommentRepository } from './comment.repository';
import { CommentService } from './comment.service';
import { WatchController } from './watch.controller';
import { WatchJobs } from './watch.jobs';
import { WatchRepository } from './watch.repository';
import { WatchService } from './watch.service';

/**
 * 留言與關注（docs/architecture/backend/24-comment.md）。只依賴 core、通知與權限、稽核，不 import 任何業務模組：
 * 擁有資源的模組 import 它，在 `onModuleInit` 以 `CommentService.registerResource()` 登記，
 * 修改資源時以 `WatchService.resourceChanged()` 通知關注者，永久刪除時以 `CommentService.removeAllFor()` 清理。
 */
@Module({
  imports: [NotificationModule],
  controllers: [CommentController, WatchController],
  providers: [
    CommentService,
    CommentRepository,
    CommentResourceRegistry,
    WatchService,
    WatchRepository,
    WatchJobs,
  ],
  exports: [CommentService, WatchService],
})
export class CommentModule {
  constructor(notificationEvents: NotificationEventCatalog) {
    notificationEvents.register(COMMENT_NOTIFICATIONS);
  }
}
