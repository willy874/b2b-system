import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequireFeature, RequirePermissions } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import { ApiZodResponse } from '@/core/validation';

import { UserIdentityListSchema } from './dto/identity-provider.dto';
import { IdentityProviderService } from './identity-provider.service';

/**
 * 帳號連結的外部身分（docs/architecture/04-sso.md §3.3.4）：管理員檢視與解除。
 * 表與規則屬於外部 IdP 模組（`user_identities`），所以端點放在這裡，路徑掛在帳號底下。
 */
@ApiTags('users')
@Controller('users/:userId/identities')
@RequireFeature('identityProvider')
export class UserIdentityController {
  constructor(private readonly providers: IdentityProviderService) {}

  @Get()
  @RequirePermissions(PERMISSION.USER_READ)
  @ApiOperation({ summary: '這個帳號連結的外部身分（連線已刪除的也列出）' })
  @ApiZodResponse(200, UserIdentityListSchema)
  list(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.providers.listOfUser(userId);
  }

  @Delete(':identityId')
  @RequirePermissions(PERMISSION.USER_UPDATE)
  @HttpCode(204)
  @ApiOperation({
    summary: '解除連結；這個外部身分下一次登入會重新對應帳號。目標是 super-admin 時操作者也要是',
  })
  async unlink(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('identityId', ParseUUIDPipe) identityId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.providers.unlinkOfUser(actor, userId, identityId);
  }
}
