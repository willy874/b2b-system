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

import { CurrentUser, RequireFeature, RequirePermissions } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import {
  ApiZodBody,
  ApiZodListResponse,
  ApiZodResponse,
  ZodValidationPipe,
} from '@/core/validation';

import { CreateGroupSchema } from './dto/create-group.dto';
import type { CreateGroupDto } from './dto/create-group.dto';
import {
  GroupMemberSchema,
  GroupRolesSchema,
  GroupSchema,
  RestoredGroupSchema,
} from './dto/group.dto';
import { ListGroupMembersSchema, ListGroupSchema } from './dto/list-group.dto';
import type { ListGroupDto, ListGroupMembersDto } from './dto/list-group.dto';
import {
  UpdateGroupMembersSchema,
  UpdateGroupRolesSchema,
  UpdateGroupSchema,
} from './dto/update-group.dto';
import type {
  UpdateGroupDto,
  UpdateGroupMembersDto,
  UpdateGroupRolesDto,
} from './dto/update-group.dto';
import { GroupService } from './group.service';

@ApiTags('groups')
@Controller('groups')
export class GroupController {
  constructor(private readonly groupService: GroupService) {}

  @Get()
  @RequirePermissions(PERMISSION.GROUP_READ)
  @ApiZodListResponse(200, GroupSchema)
  list(@Query(new ZodValidationPipe(ListGroupSchema)) query: ListGroupDto) {
    return this.groupService.list(query);
  }

  @Post()
  @RequirePermissions(PERMISSION.GROUP_CREATE)
  @ApiZodBody(CreateGroupSchema)
  @ApiZodResponse(201, GroupSchema)
  create(
    @Body(new ZodValidationPipe(CreateGroupSchema)) dto: CreateGroupDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.groupService.create(dto, actor);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.GROUP_READ)
  @ApiZodResponse(200, GroupSchema)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.groupService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.GROUP_UPDATE)
  @ApiZodBody(UpdateGroupSchema)
  @ApiZodResponse(200, GroupSchema)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateGroupSchema)) dto: UpdateGroupDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.groupService.update(id, dto, actor);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSION.GROUP_DELETE)
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    await this.groupService.remove(id, actor);
  }

  /**
   * 還原刪除的群組（能刪就能復原，docs/architecture/backend/14-revisions.md §9.2 D10）。成員與持有的角色一起生效，反提權與加成員相同（docs/rbac/01-domain-model.md §9.3 D11）。
   * 名稱已被別的群組使用時 409 `GROUP_NAME_DUPLICATE`（`details.conflictingGroupId`）；沒有被刪除 409 `GROUP_NOT_DELETED`。
   */
  @Post(':id/restore')
  @RequireFeature('trash') // 還原屬於回收桶（docs/architecture/05-tenancy.md §12.2 D3）
  @HttpCode(200)
  @RequirePermissions(PERMISSION.GROUP_DELETE)
  @ApiOperation({ summary: '還原刪除的群組（成員與持有的角色一併恢復）' })
  @ApiZodResponse(200, RestoredGroupSchema)
  restore(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.groupService.restore(id, actor);
  }

  @Get(':id/members')
  @RequirePermissions(PERMISSION.GROUP_READ, PERMISSION.USER_READ) // EVERY
  @ApiOperation({ summary: '群組的直接成員（使用者與巢狀的群組）' })
  @ApiZodListResponse(200, GroupMemberSchema)
  listMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(ListGroupMembersSchema)) query: ListGroupMembersDto,
  ) {
    return this.groupService.listMembers(id, query);
  }

  /**
   * 增減成員（差異語意）。加入的成員取得這個群組與它所有上層群組持有的角色，受反提權限制（docs/rbac/01-domain-model.md §9.3 D11）；
   * 形成循環 409 `GROUP_MEMBERSHIP_CYCLE`、巢狀太深 409 `GROUP_NESTING_TOO_DEEP`。
   */
  @Patch(':id/members')
  @RequirePermissions(PERMISSION.GROUP_UPDATE)
  @ApiOperation({ summary: '增減群組的成員（差異語意）' })
  @ApiZodBody(UpdateGroupMembersSchema)
  @ApiZodResponse(200, GroupSchema)
  updateMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateGroupMembersSchema)) dto: UpdateGroupMembersDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.groupService.updateMembers(id, dto, actor);
  }

  @Get(':id/roles')
  @RequirePermissions(PERMISSION.GROUP_READ, PERMISSION.ROLE_READ) // EVERY
  @ApiOperation({ summary: '群組持有的角色' })
  @ApiZodResponse(200, GroupRolesSchema)
  listRoles(@Param('id', ParseUUIDPipe) id: string) {
    return this.groupService.listRoles(id);
  }

  /** 增減群組持有的角色（差異語意）。受反提權限制；super-admin 一律拒絕（docs/rbac/01-domain-model.md §9.3 D12）。 */
  @Patch(':id/roles')
  @RequirePermissions(PERMISSION.GROUP_ASSIGN_ROLE)
  @ApiOperation({ summary: '增減群組持有的角色（差異語意）' })
  @ApiZodBody(UpdateGroupRolesSchema)
  @ApiZodResponse(200, GroupRolesSchema)
  updateRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateGroupRolesSchema)) dto: UpdateGroupRolesDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.groupService.updateRoles(id, dto, actor);
  }
}
