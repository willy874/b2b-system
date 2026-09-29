import { Module } from '@nestjs/common';

import { WorkspaceMemberController } from './workspace-member.controller';
import { WorkspaceMemberService } from './workspace-member.service';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceRepository } from './workspace.repository';
import { WorkspaceService } from './workspace.service';

/** 工作區：租戶邊界、成員與工作區角色（docs/adr/0018-workspace-tenancy.md）。 */
@Module({
  controllers: [WorkspaceController, WorkspaceMemberController],
  providers: [WorkspaceService, WorkspaceMemberService, WorkspaceRepository],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
