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
  Put,
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

import { CreateUserSchema } from './dto/create-user.dto';
import type { CreateUserDto } from './dto/create-user.dto';
import { ListUserSchema } from './dto/list-user.dto';
import type { ListUserDto } from './dto/list-user.dto';
import { ReplaceUserRolesSchema, UpdateUserSchema } from './dto/update-user.dto';
import type { ReplaceUserRolesDto, UpdateUserDto } from './dto/update-user.dto';
import { UserRolesSchema, UserSchema } from './dto/user.dto';
import { UserService } from './user.service';

@ApiTags('users')
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @RequirePermissions(PERMISSION.USER_READ)
  @ApiOperation({ summary: '使用者列表' })
  @ApiZodListResponse(200, UserSchema)
  list(@Query(new ZodValidationPipe(ListUserSchema)) query: ListUserDto) {
    return this.userService.list(query);
  }

  @Post()
  @RequirePermissions(PERMISSION.USER_CREATE)
  @ApiOperation({ summary: '建立使用者（status = pending，寄啟用信）' })
  @ApiZodBody(CreateUserSchema)
  @ApiZodResponse(201, UserSchema)
  create(
    @Body(new ZodValidationPipe(CreateUserSchema)) dto: CreateUserDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.userService.create(dto, actor);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.USER_READ)
  @ApiZodResponse(200, UserSchema)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.userService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.USER_UPDATE)
  @ApiZodBody(UpdateUserSchema)
  @ApiZodResponse(200, UserSchema)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateUserSchema)) dto: UpdateUserDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.userService.update(id, dto, actor);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSION.USER_DELETE)
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    await this.userService.remove(id, actor);
  }

  /**
   * 還原刪除的使用者（ADR-0025 D6、D10：能刪就能復原）。email／username 已被別的帳號使用時 409，
   * `details.conflictingUserId` 帶佔用者；沒有被刪除 409 `USER_NOT_DELETED`。
   */
  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.USER_DELETE)
  @ApiOperation({ summary: '還原刪除的使用者' })
  @ApiZodResponse(200, UserSchema)
  restore(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.userService.restore(id, actor);
  }

  @Get(':id/roles')
  @RequirePermissions(PERMISSION.USER_READ)
  @ApiZodResponse(200, UserRolesSchema)
  listRoles(@Param('id', ParseUUIDPipe) id: string) {
    return this.userService.listRoles(id);
  }

  @Put(':id/roles')
  @RequirePermissions(PERMISSION.USER_ASSIGN_ROLE)
  @ApiOperation({ summary: '整批取代使用者的角色' })
  @ApiZodBody(ReplaceUserRolesSchema)
  @ApiZodResponse(200, UserRolesSchema)
  replaceRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ReplaceUserRolesSchema)) dto: ReplaceUserRolesDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.userService.replaceRoles(id, dto, actor);
  }

  @Get(':id/permissions')
  @RequirePermissions(PERMISSION.USER_READ)
  @ApiOperation({ summary: '該使用者的有效權限集合（除錯／稽核用）' })
  listPermissions(@Param('id', ParseUUIDPipe) id: string) {
    return this.userService.listPermissions(id);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.USER_RESET_PASSWORD)
  resetPassword(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.userService.resetPassword(id, actor);
  }

  @Post(':id/unlock')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.USER_UPDATE)
  @ApiZodResponse(200, UserSchema)
  unlock(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.userService.unlock(id, actor);
  }
}
