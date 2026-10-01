import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Authenticated, CurrentUser, ExternalApi } from '@/common/decorators';
import type { AuthUser } from '@/common/types';
import { ApiZodResponse } from '@/core/validation';

import { ApiTokenService } from '../api-token.service';
import { ExternalMeSchema } from '../dto/api-token.dto';

/** 對外 API：這把 token 是誰（docs/adr/0027-api-tokens-external-api.md D14）。整合方設定好之後第一個要打的端點。 */
@ApiTags('me')
@ExternalApi()
@Controller('v1/me')
export class ApiTokenExternalController {
  constructor(private readonly tokens: ApiTokenService) {}

  @Get()
  @Authenticated()
  @ApiOperation({ summary: '這把 token 的帳號、到期時間與實際取得的權限' })
  @ApiZodResponse(200, ExternalMeSchema)
  me(@CurrentUser() actor: AuthUser) {
    return this.tokens.describeCurrent(actor);
  }
}
