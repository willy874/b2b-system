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
import {
  ApiTokenListSchema,
  CreateApiTokenSchema,
  CreatedApiTokenSchema,
} from '@/modules/api-token/dto/api-token.dto';
import type { CreateApiTokenDto } from '@/modules/api-token/dto/api-token.dto';

import {
  CreateServiceAccountSchema,
  ListServiceAccountSchema,
  ReplaceServiceAccountRolesSchema,
  ServiceAccountRolesSchema,
  ServiceAccountSchema,
  UpdateServiceAccountSchema,
} from './dto/service-account.dto';
import type {
  CreateServiceAccountDto,
  ListServiceAccountDto,
  ReplaceServiceAccountRolesDto,
  UpdateServiceAccountDto,
} from './dto/service-account.dto';
import { ServiceAccountService } from './service-account.service';

/** 服務帳號與它的 API token（docs/architecture/06-external-api.md §9.2 D1、D14）。 */
@ApiTags('service-accounts')
@Controller('service-accounts')
export class ServiceAccountController {
  constructor(private readonly accounts: ServiceAccountService) {}

  @Get()
  @RequirePermissions(PERMISSION.SERVICE_ACCOUNT_READ)
  @ApiZodListResponse(200, ServiceAccountSchema)
  list(@Query(new ZodValidationPipe(ListServiceAccountSchema)) query: ListServiceAccountDto) {
    return this.accounts.list(query);
  }

  @Post()
  @RequirePermissions(PERMISSION.SERVICE_ACCOUNT_CREATE)
  @ApiOperation({ summary: '建立服務帳號；指派的角色受反提權限制' })
  @ApiZodBody(CreateServiceAccountSchema)
  @ApiZodResponse(201, ServiceAccountSchema)
  create(
    @Body(new ZodValidationPipe(CreateServiceAccountSchema)) dto: CreateServiceAccountDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.accounts.create(dto, actor);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.SERVICE_ACCOUNT_READ)
  @ApiZodResponse(200, ServiceAccountSchema)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.SERVICE_ACCOUNT_UPDATE)
  @ApiOperation({ summary: '改名、停用、啟用；停用時它的 token 全部失效' })
  @ApiZodBody(UpdateServiceAccountSchema)
  @ApiZodResponse(200, ServiceAccountSchema)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateServiceAccountSchema)) dto: UpdateServiceAccountDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.accounts.update(id, dto, actor);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSION.SERVICE_ACCOUNT_DELETE)
  @ApiOperation({ summary: '刪除；它的 token 一併失效，不進回收桶' })
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    await this.accounts.remove(id, actor);
  }

  @Put(':id/roles')
  @RequirePermissions(PERMISSION.SERVICE_ACCOUNT_UPDATE)
  @ApiOperation({ summary: '整批取代持有的角色；受反提權限制' })
  @ApiZodBody(ReplaceServiceAccountRolesSchema)
  @ApiZodResponse(200, ServiceAccountRolesSchema)
  replaceRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ReplaceServiceAccountRolesSchema))
    dto: ReplaceServiceAccountRolesDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.accounts.replaceRoles(id, dto, actor);
  }

  @Get(':id/tokens')
  @RequirePermissions(PERMISSION.SERVICE_ACCOUNT_READ)
  @ApiOperation({ summary: '它的 API token（含已撤銷、已過期；不含 secret）' })
  @ApiZodResponse(200, ApiTokenListSchema)
  listTokens(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.listTokens(id);
  }

  @Post(':id/tokens')
  @RequirePermissions(PERMISSION.SERVICE_ACCOUNT_UPDATE)
  @ApiOperation({
    summary: '替它建立 API token；回應的 token 只出現這一次。token 的有效權限必須是操作者持有的',
  })
  @ApiZodBody(CreateApiTokenSchema)
  @ApiZodResponse(201, CreatedApiTokenSchema)
  createToken(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(CreateApiTokenSchema)) dto: CreateApiTokenDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.accounts.createToken(id, dto, actor);
  }

  @Delete(':id/tokens/:tokenId')
  @RequirePermissions(PERMISSION.SERVICE_ACCOUNT_UPDATE)
  @ApiOperation({ summary: '撤銷它的一把 API token' })
  @HttpCode(204)
  async revokeToken(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tokenId', ParseUUIDPipe) tokenId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.accounts.revokeToken(id, tokenId, actor);
  }
}
