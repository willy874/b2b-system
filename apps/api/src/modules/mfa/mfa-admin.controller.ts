import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequirePermissions, RequirePlatformPermissions } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import { ApiZodResponse } from '@/core/validation';

import { MfaAccountStatusSchema } from './dto/mfa.dto';
import { MfaAdminService } from './mfa-admin.service';

/** 管理員檢視與重設使用者的 MFA（docs/architecture/backend/21-mfa.md §8）。 */
@ApiTags('users')
@Controller('users')
export class UserMfaController {
  constructor(private readonly admin: MfaAdminService) {}

  @Get(':id/mfa')
  @RequirePermissions(PERMISSION.USER_READ)
  @ApiOperation({ summary: '使用者的驗證方式（不含機密）' })
  @ApiZodResponse(200, MfaAccountStatusSchema)
  status(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.userStatus(id);
  }

  @Post(':id/mfa/reset')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.USER_UPDATE)
  @ApiOperation({
    summary:
      '重設 MFA：刪除所有驗證方式與備用碼、結束這個人所有的 session（持有 super-admin 的人只有 super-admin 能重設）',
  })
  reset(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.admin.resetUser(actor, id);
  }
}

/** 平台管理者的 MFA 檢視與重設（apps/platform）。 */
@ApiTags('platform-admins')
@Controller('platform/admins')
export class PlatformAdminMfaController {
  constructor(private readonly admin: MfaAdminService) {}

  @Get(':id/mfa')
  @RequirePlatformPermissions('platformAdmin:read')
  @ApiOperation({ summary: '平台管理者的驗證方式（不含機密）' })
  @ApiZodResponse(200, MfaAccountStatusSchema)
  status(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.platformAdminStatus(id);
  }

  @Post(':id/mfa/reset')
  @HttpCode(200)
  @RequirePlatformPermissions('platformAdmin:update')
  @ApiOperation({ summary: '重設平台管理者的 MFA（不能重設自己）；結束對方所有的 session' })
  reset(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.admin.resetPlatformAdmin(actor, id);
  }
}
