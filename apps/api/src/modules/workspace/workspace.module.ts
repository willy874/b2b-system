import { Module } from '@nestjs/common';

import { UserModule } from '@/modules/user/user.module';

import {
  WorkspaceInvitationAcceptController,
  WorkspaceInvitationController,
} from './workspace-invitation.controller';
import { WorkspaceInvitationJobs } from './workspace-invitation.jobs';
import { WorkspaceInvitationRepository } from './workspace-invitation.repository';
import { WorkspaceInvitationService } from './workspace-invitation.service';
import { WorkspaceMemberController } from './workspace-member.controller';
import { WorkspaceMemberService } from './workspace-member.service';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceRepository } from './workspace.repository';
import { WorkspaceService } from './workspace.service';

/** 工作區：租戶邊界、成員與工作區角色、Email 邀請（docs/adr/0018-workspace-tenancy.md）。 */
@Module({
  // UserModule：邀請沒有帳號的 email 時，接受邀請要建立帳號（D14）
  imports: [UserModule],
  controllers: [
    WorkspaceController,
    WorkspaceMemberController,
    WorkspaceInvitationController,
    WorkspaceInvitationAcceptController,
  ],
  providers: [
    WorkspaceService,
    WorkspaceMemberService,
    WorkspaceRepository,
    WorkspaceInvitationService,
    WorkspaceInvitationRepository,
    WorkspaceInvitationJobs,
  ],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
