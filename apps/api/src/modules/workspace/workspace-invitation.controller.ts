import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  Authenticated,
  CurrentUser,
  CurrentWorkspace,
  Public,
  RequirePermissions,
  WorkspaceScoped,
} from '@/common/decorators';
import { AUTH_THROTTLE } from '@/common/rate-limit';
import { PERMISSION } from '@/common/types';
import type { AuthUser, WorkspaceScope } from '@/common/types';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import {
  AcceptedWorkspaceInvitationSchema,
  AcceptWorkspaceInvitationSchema,
  CreateWorkspaceInvitationSchema,
  PreviewWorkspaceInvitationSchema,
  SignupWorkspaceInvitationSchema,
  WorkspaceInvitationListSchema,
  WorkspaceInvitationPreviewSchema,
  WorkspaceInvitationSchema,
} from './dto/workspace.dto';
import type {
  AcceptWorkspaceInvitationDto,
  CreateWorkspaceInvitationDto,
  PreviewWorkspaceInvitationDto,
  SignupWorkspaceInvitationDto,
} from './dto/workspace.dto';
import { WorkspaceInvitationService } from './workspace-invitation.service';

/** 工作區內的邀請管理（docs/adr/0018-workspace-tenancy.md D14）。 */
@ApiTags('workspaces')
@WorkspaceScoped()
@Controller('workspaces/:workspaceId/invitations')
export class WorkspaceInvitationController {
  constructor(private readonly invitations: WorkspaceInvitationService) {}

  @Get()
  @RequirePermissions(PERMISSION.WORKSPACE_MEMBER_READ)
  @ApiOperation({ summary: '待接受的邀請（含已過期）' })
  @ApiZodResponse(200, WorkspaceInvitationListSchema)
  list(@CurrentWorkspace() ws: WorkspaceScope) {
    return this.invitations.list(ws);
  }

  @Post()
  @RequirePermissions(PERMISSION.WORKSPACE_MEMBER_CREATE)
  @ApiOperation({
    summary: '以 email 邀請（角色受反提權限制；沒有帳號的 email 另需平台的 user:create）',
  })
  @ApiZodBody(CreateWorkspaceInvitationSchema)
  @ApiZodResponse(201, WorkspaceInvitationSchema)
  invite(
    @CurrentWorkspace() ws: WorkspaceScope,
    @Body(new ZodValidationPipe(CreateWorkspaceInvitationSchema)) dto: CreateWorkspaceInvitationDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.invitations.invite(ws, dto, actor);
  }

  @Delete(':invitationId')
  @RequirePermissions(PERMISSION.WORKSPACE_MEMBER_CREATE)
  @ApiOperation({ summary: '撤銷待接受的邀請' })
  @HttpCode(204)
  async revoke(
    @CurrentWorkspace() ws: WorkspaceScope,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.invitations.revoke(ws, invitationId, actor);
  }
}

/** 受邀者以信中的 token 查看與接受邀請；還不是成員，所以不是工作區範圍的路由。 */
@ApiTags('workspaces')
@Controller('workspace-invitations')
export class WorkspaceInvitationAcceptController {
  constructor(private readonly invitations: WorkspaceInvitationService) {}

  @Get('preview')
  @Public()
  @Throttle({ default: AUTH_THROTTLE })
  @ApiOperation({ summary: '接受邀請頁的資訊（token 無效回 WORKSPACE_INVITATION_INVALID）' })
  @ApiZodResponse(200, WorkspaceInvitationPreviewSchema)
  preview(
    @Query(new ZodValidationPipe(PreviewWorkspaceInvitationSchema))
    query: PreviewWorkspaceInvitationDto,
  ) {
    return this.invitations.preview(query.token);
  }

  @Post('accept')
  @HttpCode(200)
  @Authenticated()
  @ApiOperation({ summary: '以目前登入的帳號接受（帳號 email 必須是受邀的 email）' })
  @ApiZodBody(AcceptWorkspaceInvitationSchema)
  @ApiZodResponse(200, AcceptedWorkspaceInvitationSchema)
  accept(
    @Body(new ZodValidationPipe(AcceptWorkspaceInvitationSchema)) dto: AcceptWorkspaceInvitationDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.invitations.accept(dto.token, actor);
  }

  @Post('signup')
  @HttpCode(200)
  @Public()
  @Throttle({ default: AUTH_THROTTLE })
  @ApiOperation({ summary: '還沒有帳號：設定密碼、建立已啟用的帳號並加入工作區' })
  @ApiZodBody(SignupWorkspaceInvitationSchema)
  @ApiZodResponse(200, AcceptedWorkspaceInvitationSchema)
  signup(
    @Body(new ZodValidationPipe(SignupWorkspaceInvitationSchema)) dto: SignupWorkspaceInvitationDto,
  ) {
    return this.invitations.signup(dto);
  }
}
