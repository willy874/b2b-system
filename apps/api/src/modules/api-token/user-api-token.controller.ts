import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequireFeature, RequirePermissions } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import { NoStore } from '@/core/http';
import { ApiZodResponse } from '@/core/validation';

import { ApiTokenService } from './api-token.service';
import { ApiTokenListSchema } from './dto/api-token.dto';

/**
 * 管理者檢視、撤銷別人的個人 API token（docs/architecture/06-external-api.md §9.2 D14）：用 `user:update`，
 * 與停用、強制登出同一個層級。不能替別人建立個人 token。租戶沒有啟用 `externalApi` 時一併關閉
 * （docs/architecture/06-external-api.md §3.1）。
 */
@ApiTags('api-tokens')
@Controller('users/:userId/api-tokens')
@RequireFeature('externalApi')
@NoStore()
export class UserApiTokenController {
  constructor(private readonly tokens: ApiTokenService) {}

  @Get()
  @RequirePermissions(PERMISSION.USER_UPDATE)
  @ApiOperation({ summary: '這位使用者的個人 API token（不含 secret）' })
  @ApiZodResponse(200, ApiTokenListSchema)
  list(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.tokens.listForUser(userId);
  }

  @Delete(':tokenId')
  @RequirePermissions(PERMISSION.USER_UPDATE)
  @ApiOperation({ summary: '撤銷這位使用者的個人 API token' })
  @HttpCode(204)
  async revoke(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('tokenId', ParseUUIDPipe) tokenId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.tokens.revokeForUser(userId, tokenId, actor);
  }
}
