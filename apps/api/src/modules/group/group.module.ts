import { Module } from '@nestjs/common';

import { AnnouncementTriggerCatalog } from '@/modules/announcement/announcement-trigger.catalog';
import { AnnouncementModule } from '@/modules/announcement/announcement.module';
import { TrashModule } from '@/modules/trash/trash.module';

import { GroupTrashHandler } from './group-trash.handler';
import { GROUP_ANNOUNCEMENT_TRIGGERS } from './group.announcement-triggers';
import { GroupController } from './group.controller';
import { GroupRepository } from './group.repository';
import { GroupService } from './group.service';

@Module({
  imports: [TrashModule, AnnouncementModule],
  controllers: [GroupController],
  providers: [GroupService, GroupRepository, GroupTrashHandler],
  exports: [GroupService],
})
export class GroupModule {
  constructor(announcementTriggers: AnnouncementTriggerCatalog) {
    announcementTriggers.register(GROUP_ANNOUNCEMENT_TRIGGERS);
  }
}
