import { Module } from '@nestjs/common';

import { TrashModule } from '@/modules/trash/trash.module';

import { GroupTrashHandler } from './group-trash.handler';
import { GroupController } from './group.controller';
import { GroupRepository } from './group.repository';
import { GroupService } from './group.service';

@Module({
  imports: [TrashModule],
  controllers: [GroupController],
  providers: [GroupService, GroupRepository, GroupTrashHandler],
  exports: [GroupService],
})
export class GroupModule {}
