import { Module } from '@nestjs/common';

import { TrashModule } from '@/modules/trash/trash.module';

import { RoleTrashHandler } from './role-trash.handler';
import { RoleController } from './role.controller';
import { RoleRepository } from './role.repository';
import { RoleService } from './role.service';

@Module({
  imports: [TrashModule],
  controllers: [RoleController],
  providers: [RoleService, RoleRepository, RoleTrashHandler],
  exports: [RoleService, RoleRepository],
})
export class RoleModule {}
