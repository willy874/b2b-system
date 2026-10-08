import { Module } from '@nestjs/common';

import { DataTransferModule } from '@/modules/data-transfer/data-transfer.module';
import { RevisionModule } from '@/modules/revision/revision.module';
import { TrashModule } from '@/modules/trash/trash.module';

import { RoleTrashHandler } from './role-trash.handler';
import { RoleController } from './role.controller';
import { RoleRepository } from './role.repository';
import { RoleService } from './role.service';
import { RoleTransferResource } from './role.transfer';

@Module({
  imports: [TrashModule, RevisionModule, DataTransferModule],
  controllers: [RoleController],
  providers: [RoleService, RoleRepository, RoleTrashHandler, RoleTransferResource],
  exports: [RoleService],
})
export class RoleModule {}
