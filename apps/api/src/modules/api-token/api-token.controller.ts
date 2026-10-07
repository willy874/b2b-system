import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Authenticated, CurrentUser, RequireFeature } from '@/common/decorators';
import type { AuthUser } from '@/common/types';
import { NoStore } from '@/core/http';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import { ApiTokenService } from './api-token.service';
import {
  ApiTokenListSchema,
  CreateApiTokenSchema,
  CreatedApiTokenSchema,
} from './dto/api-token.dto';
import type { CreateApiTokenDto } from './dto/api-token.dto';

/**
 * 自己的個人 API token（docs/architecture/06-external-api.md §9.2 D2、D14）：與 `/auth/profile` 同屬個人範圍，
 * 只要登入。token 只在對外 API 有效，這裡只是管理；租戶沒有啟用 `externalApi` 時一併關閉
 * （docs/architecture/06-external-api.md §3.1）。
 */
@ApiTags('api-tokens')
@Controller('auth/api-tokens')
@RequireFeature('externalApi')
@NoStore()
export class ApiTokenController {
  constructor(private readonly tokens: ApiTokenService) {}

  @Get()
  @Authenticated()
  @ApiOperation({ summary: '我的個人 API token（含已撤銷、已過期；不含 secret）' })
  @ApiZodResponse(200, ApiTokenListSchema)
  list(@CurrentUser() actor: AuthUser) {
    return this.tokens.listMine(actor);
  }

  @Post()
  @Authenticated()
  @ApiOperation({ summary: '建立個人 API token；回應的 token 只出現這一次' })
  @ApiZodBody(CreateApiTokenSchema)
  @ApiZodResponse(201, CreatedApiTokenSchema)
  create(
    @Body(new ZodValidationPipe(CreateApiTokenSchema)) dto: CreateApiTokenDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.tokens.createMine(actor, dto);
  }

  @Delete(':tokenId')
  @Authenticated()
  @ApiOperation({ summary: '撤銷自己的個人 API token' })
  @HttpCode(204)
  async revoke(@Param('tokenId', ParseUUIDPipe) tokenId: string, @CurrentUser() actor: AuthUser) {
    await this.tokens.revokeMine(actor, tokenId);
  }
}
