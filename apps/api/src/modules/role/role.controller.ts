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

import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import {
  ApiZodBody,
  ApiZodListResponse,
  ApiZodResponse,
  ZodValidationPipe,
} from '@/core/validation';

import { CreateRoleSchema, DuplicateRoleSchema } from './dto/create-role.dto';
import type { CreateRoleDto, DuplicateRoleDto } from './dto/create-role.dto';
import { DeleteRoleSchema, ListRoleSchema, ListRoleUsersSchema } from './dto/list-role.dto';
import type { DeleteRoleDto, ListRoleDto, ListRoleUsersDto } from './dto/list-role.dto';
import { RoleHolderSchema, RolePermissionsSchema, RoleSchema } from './dto/role.dto';
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
