import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Authenticated, CurrentUser, RequirePermissions } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import {
  ApiZodBody,
  ApiZodListResponse,
  ApiZodResponse,
  ZodValidationPipe,
} from '@/core/validation';

import {
  AssignWorkspaceAdminSchema,
  CreateWorkspaceSchema,
  ListWorkspaceSchema,
  MyWorkspaceListSchema,
  UpdateWorkspaceSchema,
  WorkspaceDetailSchema,
  WorkspaceSchema,
} from './dto/workspace.dto';
import type {
  AssignWorkspaceAdminDto,
  CreateWorkspaceDto,
  ListWorkspaceDto,
  UpdateWorkspaceDto,
} from './dto/workspace.dto';
import { WorkspaceService } from './workspace.service';

/**
 * 平台層級的工作區管理（`workspace:*`，docs/adr/0018-workspace-tenancy.md D5）：
 * 看得到名稱、成員數與管理員，看不到工作區裡的內容。成員管理在 `WorkspaceMemberController`。
 */
@ApiTags('workspaces')
@Controller('workspaces')
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  /** 必須在 `:workspaceId` 之前註冊：Express 依註冊順序比對。 */
  @Get('mine')
  @Authenticated()
  @ApiOperation({ summary: '自己能進入的工作區（super-admin 是全部）' })
  @ApiZodResponse(200, MyWorkspaceListSchema)
  listMine(@CurrentUser() actor: AuthUser) {
    return this.workspaceService.listMine(actor);
  }

  @Get()
  @RequirePermissions(PERMISSION.WORKSPACE_READ)
  @ApiZodListResponse(200, WorkspaceSchema)
  list(@Query(new ZodValidationPipe(ListWorkspaceSchema)) query: ListWorkspaceDto) {
    return this.workspaceService.list(query);
  }

  @Post()
  @RequirePermissions(PERMISSION.WORKSPACE_CREATE)
  @ApiOperation({ summary: '建立工作區並指定第一位管理員' })
  @ApiZodBody(CreateWorkspaceSchema)
  @ApiZodResponse(201, WorkspaceDetailSchema)
  create(
    @Body(new ZodValidationPipe(CreateWorkspaceSchema)) dto: CreateWorkspaceDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.workspaceService.create(dto, actor);
  }

  @Get(':workspaceId')
  @RequirePermissions(PERMISSION.WORKSPACE_READ)
  @ApiZodResponse(200, WorkspaceDetailSchema)
  findOne(@Param('workspaceId', ParseUUIDPipe) id: string) {
    return this.workspaceService.findOne(id);
  }

  @Patch(':workspaceId')
  @RequirePermissions(PERMISSION.WORKSPACE_UPDATE)
  @ApiZodBody(UpdateWorkspaceSchema)
  @ApiZodResponse(200, WorkspaceDetailSchema)
  update(
    @Param('workspaceId', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateWorkspaceSchema)) dto: UpdateWorkspaceDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.workspaceService.update(id, dto, actor);
  }

  @Delete(':workspaceId')
  @RequirePermissions(PERMISSION.WORKSPACE_DELETE)
  @HttpCode(204)
  async remove(@Param('workspaceId', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    await this.workspaceService.remove(id, actor);
  }

  @Post(':workspaceId/admins')
  @RequirePermissions(PERMISSION.WORKSPACE_UPDATE)
  @ApiOperation({ summary: '指定管理員（加入成員並給 workspace-admin；留下稽核）' })
  @ApiZodBody(AssignWorkspaceAdminSchema)
  @ApiZodResponse(201, WorkspaceDetailSchema)
  assignAdmin(
    @Param('workspaceId', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(AssignWorkspaceAdminSchema)) dto: AssignWorkspaceAdminDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.workspaceService.assignAdmin(id, dto, actor);
  }
}
