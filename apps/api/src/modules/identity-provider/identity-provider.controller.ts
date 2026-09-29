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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import {
  CreateIdentityProviderSchema,
  IdentityProviderListSchema,
  IdentityProviderSchema,
  UpdateIdentityProviderSchema,
} from './dto/identity-provider.dto';
import type {
  CreateIdentityProviderDto,
  UpdateIdentityProviderDto,
} from './dto/identity-provider.dto';
import { IdentityProviderService } from './identity-provider.service';

/** 外部 IdP 連線的管理（平台範圍，docs/adr/0019-sso-identity-platform.md D8、D9）。 */
@ApiTags('identity-providers')
@Controller('identity-providers')
export class IdentityProviderController {
  constructor(private readonly providers: IdentityProviderService) {}

  @Get()
  @RequirePermissions(PERMISSION.IDENTITY_PROVIDER_READ)
  @ApiOperation({ summary: '所有連線（不含 client secret）與要登記在外部 IdP 的 redirect URI' })
  @ApiZodResponse(200, IdentityProviderListSchema)
  list() {
    return this.providers.list();
  }

  @Post()
  @RequirePermissions(PERMISSION.IDENTITY_PROVIDER_CREATE)
  @ApiZodBody(CreateIdentityProviderSchema)
  @ApiZodResponse(201, IdentityProviderSchema)
  create(
    @Body(new ZodValidationPipe(CreateIdentityProviderSchema)) dto: CreateIdentityProviderDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.providers.create(dto, actor);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.IDENTITY_PROVIDER_UPDATE)
  @ApiOperation({ summary: '更新；clientSecret 有給才更換，domains 有給就整批取代' })
  @ApiZodBody(UpdateIdentityProviderSchema)
  @ApiZodResponse(200, IdentityProviderSchema)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateIdentityProviderSchema)) dto: UpdateIdentityProviderDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.providers.update(id, dto, actor);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSION.IDENTITY_PROVIDER_DELETE)
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    await this.providers.remove(id, actor);
  }
}
