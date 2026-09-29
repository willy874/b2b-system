import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  Authenticated,
  CurrentUser,
  CurrentWorkspace,
  RequirePermissions,
  WorkspaceScoped,
} from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { AuthUser, WorkspaceScope } from '@/common/types';
import {
  ApiZodBody,
  ApiZodListResponse,
  ApiZodResponse,
  ZodValidationPipe,
} from '@/core/validation';

import {
  ListWorkspaceMemberSchema,
  UpdateWorkspaceMemberRolesSchema,
  WorkspaceMeSchema,
  WorkspaceMemberRolesSchema,
  WorkspaceMemberSchema,
  WorkspaceRoleListSchema,
} from './dto/workspace.dto';
import type { ListWorkspaceMemberDto, UpdateWorkspaceMemberRolesDto } from './dto/workspace.dto';
import { WorkspaceMemberService } from './workspace-member.service';
import { WorkspaceService } from './workspace.service';

/** 工作區內（成員才進得來，docs/adr/0018-workspace-tenancy.md D9）：自己的身分與成員管理。 */
@ApiTags('workspaces')
@WorkspaceScoped()
@Controller('workspaces/:workspaceId')
export class WorkspaceMemberController {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly memberService: WorkspaceMemberService,
  ) {}

  @Get('me')
  @Authenticated()
  @ApiOperation({ summary: '自己在這個工作區的角色與權限鍵（進入工作區時呼叫）' })
  @ApiZodResponse(200, WorkspaceMeSchema)
  me(@CurrentWorkspace() ws: WorkspaceScope, @CurrentUser() actor: AuthUser) {
    return this.workspaceService.me(ws, actor);
  }

  @Get('members')
  @RequirePermissions(PERMISSION.WORKSPACE_MEMBER_READ)
  @ApiZodListResponse(200, WorkspaceMemberSchema)
  listMembers(
    @CurrentWorkspace() ws: WorkspaceScope,
    @Query(new ZodValidationPipe(ListWorkspaceMemberSchema)) query: ListWorkspaceMemberDto,
  ) {
    return this.memberService.list(ws, query);
  }

  @Put('members/:userId/roles')
  @RequirePermissions(PERMISSION.WORKSPACE_MEMBER_ASSIGN_ROLE)
  @ApiOperation({ summary: '整批取代成員的工作區角色（受反提權限制）' })
  @ApiZodBody(UpdateWorkspaceMemberRolesSchema)
  @ApiZodResponse(200, WorkspaceMemberRolesSchema)
  updateRoles(
    @CurrentWorkspace() ws: WorkspaceScope,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodValidationPipe(UpdateWorkspaceMemberRolesSchema))
    dto: UpdateWorkspaceMemberRolesDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.memberService.updateRoles(ws, userId, dto, actor);
  }

  @Delete('members/:userId')
  @RequirePermissions(PERMISSION.WORKSPACE_MEMBER_DELETE)
  @HttpCode(204)
  async removeMember(
    @CurrentWorkspace() ws: WorkspaceScope,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.memberService.remove(ws, userId, actor);
  }

  @Get('roles')
  @RequirePermissions(PERMISSION.WORKSPACE_MEMBER_READ)
  @ApiOperation({ summary: '可以指派的工作區角色（不需要平台的 role:read）' })
  @ApiZodResponse(200, WorkspaceRoleListSchema)
  listRoles() {
    return this.memberService.listRoles();
  }
}
