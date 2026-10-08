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

import {
  CreateOrgUnitSchema,
  ListOrgUnitMembersSchema,
  ListOrgUnitSchema,
  MoveOrgUnitSchema,
  OrgUnitDetailSchema,
  OrgUnitMemberSchema,
  OrgUnitTreeSchema,
  UpdateOrgUnitMembersSchema,
  UpdateOrgUnitSchema,
  UserOrgUnitsSchema,
} from './dto/org-unit.dto';
import type {
  CreateOrgUnitDto,
  ListOrgUnitDto,
  ListOrgUnitMembersDto,
  MoveOrgUnitDto,
  UpdateOrgUnitDto,
  UpdateOrgUnitMembersDto,
} from './dto/org-unit.dto';
import { OrgUnitService } from './org-unit.service';

/**
 * 組織的部門（docs/architecture/backend/23-organization.md）。可由平台關閉（`organization`，D2）：停用時整個 controller 回 404。
 */
@ApiTags('org-units')
@Controller('org-units')
@RequireFeature('organization')
export class OrgUnitController {
  constructor(private readonly service: OrgUnitService) {}

  @Get()
  @RequirePermissions(PERMISSION.ORG_UNIT_READ)
  @ApiOperation({ summary: '整棵部門樹（扁平陣列）' })
  @ApiZodResponse(200, OrgUnitTreeSchema)
  list(@Query(new ZodValidationPipe(ListOrgUnitSchema)) query: ListOrgUnitDto) {
    return this.service.list(query);
  }

  @Post()
  @RequirePermissions(PERMISSION.ORG_UNIT_CREATE)
  @ApiZodBody(CreateOrgUnitSchema)
  @ApiZodResponse(201, OrgUnitDetailSchema)
  create(
    @Body(new ZodValidationPipe(CreateOrgUnitSchema)) dto: CreateOrgUnitDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.service.create(dto, actor);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.ORG_UNIT_READ)
  @ApiZodResponse(200, OrgUnitDetailSchema)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.ORG_UNIT_UPDATE)
  @ApiZodBody(UpdateOrgUnitSchema)
  @ApiZodResponse(200, OrgUnitDetailSchema)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateOrgUnitSchema)) dto: UpdateOrgUnitDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.service.update(id, dto, actor);
  }

  /** 換上層與同層的排序。循環 409 `ORG_UNIT_CYCLE`、超過層數 409 `ORG_UNIT_TOO_DEEP`。 */
  @Post(':id/move')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.ORG_UNIT_UPDATE)
  @ApiOperation({ summary: '搬移部門（換上層、同層排序）' })
  @ApiZodBody(MoveOrgUnitSchema)
  @ApiZodResponse(200, OrgUnitDetailSchema)
  move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(MoveOrgUnitSchema)) dto: MoveOrgUnitDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.service.move(id, dto, actor);
  }

  /** 軟刪除；還有下層部門 409 `ORG_UNIT_HAS_CHILDREN`。 */
  @Delete(':id')
  @RequirePermissions(PERMISSION.ORG_UNIT_DELETE)
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    await this.service.remove(id, actor);
  }

  /** 還原（能刪就能復原）；上層已刪除 409 `ORG_UNIT_PARENT_DELETED`。 */
  @Post(':id/restore')
  @RequireFeature('trash') // 還原屬於回收桶（docs/architecture/05-tenancy.md §12.2 D3）
  @HttpCode(200)
  @RequirePermissions(PERMISSION.ORG_UNIT_DELETE)
  @ApiOperation({ summary: '還原刪除的部門（成員資格一併恢復）' })
  @ApiZodResponse(200, OrgUnitDetailSchema)
  restore(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.service.restore(id, actor);
  }

  @Get(':id/members')
  @RequirePermissions(PERMISSION.ORG_UNIT_READ, PERMISSION.USER_READ) // EVERY
  @ApiOperation({ summary: '部門的成員（可含下層部門）' })
  @ApiZodListResponse(200, OrgUnitMemberSchema)
  listMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(ListOrgUnitMembersSchema)) query: ListOrgUnitMembersDto,
  ) {
    return this.service.listMembers(id, query);
  }

  /** 增減、修改成員（差異語意）；不能改自己（403 `AUTHZ_SELF_MODIFY`）。 */
  @Patch(':id/members')
  @RequirePermissions(PERMISSION.ORG_UNIT_UPDATE)
  @ApiOperation({ summary: '增減、修改部門的成員（差異語意）' })
  @ApiZodBody(UpdateOrgUnitMembersSchema)
  @ApiZodResponse(200, OrgUnitDetailSchema)
  updateMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateOrgUnitMembersSchema)) dto: UpdateOrgUnitMembersDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.service.updateMembers(id, dto, actor);
  }
}

/** 使用者詳情的「所屬部門」。 */
@ApiTags('org-units')
@Controller('users')
@RequireFeature('organization')
export class UserOrgUnitController {
  constructor(private readonly service: OrgUnitService) {}

  @Get(':id/org-units')
  @RequirePermissions(PERMISSION.ORG_UNIT_READ)
  @ApiOperation({ summary: '使用者所屬的部門（主要部門在前）' })
  @ApiZodResponse(200, UserOrgUnitsSchema)
  listOfUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.unitsOfUser(id);
  }
}
