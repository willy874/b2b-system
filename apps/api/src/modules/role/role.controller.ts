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
  ListRevisionSchema,
  RevisionSummarySchema,
  RevisionVersionSchema,
} from '@/modules/revision/dto/revision.dto';
import type { ListRevisionDto } from '@/modules/revision/dto/revision.dto';

import { CreateRoleSchema, DuplicateRoleSchema } from './dto/create-role.dto';
import type { CreateRoleDto, DuplicateRoleDto } from './dto/create-role.dto';
import { DeleteRoleSchema, ListRoleSchema, ListRoleUsersSchema } from './dto/list-role.dto';
import type { DeleteRoleDto, ListRoleDto, ListRoleUsersDto } from './dto/list-role.dto';
import { RevertRoleRevisionSchema, RoleRevisionSchema } from './dto/role-revision.dto';
import type { RevertRoleRevisionDto } from './dto/role-revision.dto';
import {
  RestoredRoleSchema,
  RoleHolderSchema,
  RolePermissionsSchema,
  RoleSchema,
} from './dto/role.dto';
import { UpdateRolePermissionsSchema, UpdateRoleSchema } from './dto/update-role.dto';
import type { UpdateRoleDto, UpdateRolePermissionsDto } from './dto/update-role.dto';
import { RoleService } from './role.service';

@ApiTags('roles')
@Controller('roles')
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  @RequirePermissions(PERMISSION.ROLE_READ)
  @ApiZodListResponse(200, RoleSchema)
  list(@Query(new ZodValidationPipe(ListRoleSchema)) query: ListRoleDto) {
    return this.roleService.list(query);
  }

  @Post()
  @RequirePermissions(PERMISSION.ROLE_CREATE)
  @ApiZodBody(CreateRoleSchema)
  @ApiZodResponse(201, RoleSchema)
  create(
    @Body(new ZodValidationPipe(CreateRoleSchema)) dto: CreateRoleDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.roleService.create(dto, actor);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.ROLE_READ)
  @ApiZodResponse(200, RoleSchema)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.roleService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.ROLE_UPDATE)
  @ApiZodBody(UpdateRoleSchema)
  @ApiZodResponse(200, RoleSchema)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateRoleSchema)) dto: UpdateRoleDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.roleService.update(id, dto, actor);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSION.ROLE_DELETE)
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(DeleteRoleSchema)) query: DeleteRoleDto,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.roleService.remove(id, query, actor);
  }

  /**
   * 還原刪除的角色（docs/architecture/backend/14-revisions.md §9.2 D2、D10：能刪就能復原）。名稱或 slug 已被別的角色使用時 409 `ROLE_NAME_DUPLICATE`，
   * `details.conflictingRoleId` 帶佔用者；沒有被刪除 409 `ROLE_NOT_DELETED`；角色的權限鍵有 actor 沒有的 403。
   */
  @Post(':id/restore')
  @RequireFeature('trash') // 還原屬於回收桶（docs/architecture/05-tenancy.md §12.2 D3）
  @HttpCode(200)
  @RequirePermissions(PERMISSION.ROLE_DELETE)
  @ApiOperation({ summary: '還原刪除的角色（原本的持有者一併恢復）' })
  @ApiZodResponse(200, RestoredRoleSchema)
  restore(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.roleService.restore(id, actor);
  }

  /** 版本歷史（docs/architecture/backend/14-revisions.md §9.2 D10：看版本＝看得到角色）。新的在前；過大未保存的版本 `tooLarge: true`。 */
  @Get(':id/revisions')
  @RequirePermissions(PERMISSION.ROLE_READ)
  @ApiOperation({ summary: '角色的版本歷史（新的在前）' })
  @ApiZodListResponse(200, RevisionSummarySchema)
  listRevisions(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(ListRevisionSchema)) query: ListRevisionDto,
  ) {
    return this.roleService.listRevisions(id, query);
  }

  @Get(':id/revisions/:version')
  @RequirePermissions(PERMISSION.ROLE_READ)
  @ApiOperation({ summary: '角色的某一版（含快照）' })
  @ApiZodResponse(200, RoleRevisionSchema)
  getRevision(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', new ZodValidationPipe(RevisionVersionSchema)) version: number,
  ) {
    return this.roleService.getRevision(id, version);
  }

  /**
   * 還原到某一版（docs/architecture/backend/14-revisions.md §9.2 D10：`role:update`；權限鍵會改變時 service 另外要求 `role:grantPermission` 並做反提權）。
   * 當成一次新的更新：角色的 `version` + 1、產生新的一版；過大未保存的版本 409 `REVISION_UNAVAILABLE`。
   */
  @Post(':id/revisions/:version/revert')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.ROLE_UPDATE)
  @ApiOperation({ summary: '把角色還原到某一版（產生新的一版）' })
  @ApiZodBody(RevertRoleRevisionSchema)
  @ApiZodResponse(200, RoleSchema)
  revertToRevision(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', new ZodValidationPipe(RevisionVersionSchema)) version: number,
    @Body(new ZodValidationPipe(RevertRoleRevisionSchema)) dto: RevertRoleRevisionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.roleService.revertToRevision(id, version, dto, actor);
  }

  @Get(':id/permissions')
  @RequirePermissions(PERMISSION.ROLE_READ, PERMISSION.PERMISSION_READ) // EVERY
  @ApiZodResponse(200, RolePermissionsSchema)
  listPermissions(@Param('id', ParseUUIDPipe) id: string) {
    return this.roleService.listPermissions(id);
  }

  @Patch(':id/permissions')
  @RequirePermissions(PERMISSION.ROLE_GRANT_PERMISSION)
  @ApiOperation({ summary: '增減角色權限（差異語意）' })
  @ApiZodBody(UpdateRolePermissionsSchema)
  @ApiZodResponse(200, RolePermissionsSchema)
  updatePermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateRolePermissionsSchema)) dto: UpdateRolePermissionsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.roleService.updatePermissions(id, dto, actor);
  }

  @Get(':id/users')
  @RequirePermissions(PERMISSION.ROLE_READ, PERMISSION.USER_READ) // EVERY
  @ApiZodListResponse(200, RoleHolderSchema)
  listUsers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(ListRoleUsersSchema)) query: ListRoleUsersDto,
  ) {
    return this.roleService.listUsers(id, query);
  }

  @Post(':id/duplicate')
  @RequirePermissions(PERMISSION.ROLE_CREATE)
  @ApiOperation({ summary: '以既有角色為範本建立新角色（受反提權限制）' })
  @ApiZodBody(DuplicateRoleSchema)
  @ApiZodResponse(201, RoleSchema)
  duplicate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(DuplicateRoleSchema)) dto: DuplicateRoleDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.roleService.duplicate(id, dto, actor);
  }
}
