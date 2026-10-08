import { Module } from '@nestjs/common';

import { TenantFeatureImpacts } from '@/core/tenant';
import { AnnouncementTriggerCatalog } from '@/modules/announcement/announcement-trigger.catalog';
import { AnnouncementModule } from '@/modules/announcement/announcement.module';
import { DataTransferModule } from '@/modules/data-transfer/data-transfer.module';
import { TrashModule } from '@/modules/trash/trash.module';

import { GroupTrashHandler } from './group-trash.handler';
import { GROUP_ANNOUNCEMENT_TRIGGERS } from './group.announcement-triggers';
import { GroupController } from './group.controller';
import { GroupRepository } from './group.repository';
import { GroupService } from './group.service';
import { GroupTransferResource } from './group.transfer';

@Module({
  imports: [TrashModule, AnnouncementModule, DataTransferModule],
  controllers: [GroupController],
  providers: [GroupService, GroupRepository, GroupTrashHandler, GroupTransferResource],
  exports: [GroupService],
})
export class GroupModule {
  constructor(
    announcementTriggers: AnnouncementTriggerCatalog,
    impacts: TenantFeatureImpacts,
    repo: GroupRepository,
  ) {
    announcementTriggers.register(GROUP_ANNOUNCEMENT_TRIGGERS);
    // 平台關閉 `group` 前的確認框列出的數量（docs/architecture/iam/07-groups.md §8）
    impacts.register('group', async () => {
      const impact = await repo.countImpact();
      return {
        groups: impact.groups,
        groupMembers: impact.members,
        groupRoleGrants: impact.roleGrants,
      };
    });
  }
}
