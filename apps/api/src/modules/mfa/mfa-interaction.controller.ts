import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { Public } from '@/common/decorators';
import { RateLimit } from '@/common/rate-limit';
import { NoStore } from '@/core/http';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';
import { InteractionUidPipe } from '@/modules/oidc-provider/interaction-uid';
import { SsoRedirectSchema } from '@/modules/oidc-provider/sso-redirect.dto';

import {
  ConfirmMfaEnrollmentSchema,
  MfaChallengeInfoSchema,
  MfaEnrollmentSchema,
  MfaInteractionEnrollmentResultSchema,
  MfaLoginChallengeSchema,
  MfaLoginVerifySchema,
  StartMfaEnrollmentSchema,
} from './dto/mfa.dto';
import type {
  ConfirmMfaEnrollmentDto,
  MfaLoginChallengeDto,
  MfaLoginVerifyDto,
  StartMfaEnrollmentDto,
} from './dto/mfa.dto';
import { MfaLoginService } from './mfa-login.service';

/**
 * 登入互動的第二步（docs/architecture/backend/21-mfa.md §4）。與 `SsoInteractionController` 同一個路徑前綴：
 * 互動 cookie 設在 `/api/oidc-interaction/:uid`，瀏覽器只有在這底下才帶它。全部是 `@Public()`：互動 cookie ＋
 * 密碼步驟留下的 `MfaPending` 就是憑證。
 */
@ApiTags('auth')
@Controller('oidc-interaction')
@NoStore()
export class MfaInteractionController {
  constructor(private readonly login: MfaLoginService) {}

  @Post(':uid/mfa/challenge')
  @HttpCode(200)
  @Public()
  @RateLimit('authMail')
  @ApiOperation({ summary: '第二步：請伺服器發出驗證碼（Email 之類 challenge = server 的方式）' })
  @ApiZodBody(MfaLoginChallengeSchema)
  @ApiZodResponse(200, MfaChallengeInfoSchema)
  challenge(
    @Param('uid', InteractionUidPipe) uid: string,
    @Body(new ZodValidationPipe(MfaLoginChallengeSchema)) dto: MfaLoginChallengeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.login.challenge(req, res, uid, dto);
  }

  @Post(':uid/mfa/verify')
  @HttpCode(200)
  @Public()
  @RateLimit('auth')
  @ApiOperation({ summary: '第二步：驗證碼或備用碼；成功時回傳要頂層跳轉的 resume 網址' })
  @ApiZodBody(MfaLoginVerifySchema)
  @ApiZodResponse(200, SsoRedirectSchema)
  verify(
    @Param('uid', InteractionUidPipe) uid: string,
    @Body(new ZodValidationPipe(MfaLoginVerifySchema)) dto: MfaLoginVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.login.verify(req, res, uid, dto);
  }

  @Post(':uid/mfa/enroll')
  @HttpCode(200)
  @Public()
  @RateLimit('authMail')
  @ApiOperation({ summary: '必須啟用 MFA 而還沒設定：在互動中開始設定一種方式' })
  @ApiZodBody(StartMfaEnrollmentSchema)
  @ApiZodResponse(200, MfaEnrollmentSchema)
  startEnrollment(
    @Param('uid', InteractionUidPipe) uid: string,
    @Body(new ZodValidationPipe(StartMfaEnrollmentSchema)) dto: StartMfaEnrollmentDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.login.startEnrollment(req, res, uid, dto.method);
  }

  @Post(':uid/mfa/enroll/:factorId/challenge')
  @HttpCode(200)
  @Public()
  @RateLimit('authMail')
  @ApiOperation({ summary: '互動中的設定：重寄驗證碼' })
  @ApiZodResponse(200, MfaChallengeInfoSchema)
  resendEnrollment(
    @Param('uid', InteractionUidPipe) uid: string,
    @Param('factorId', ParseUUIDPipe) factorId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.login.resendEnrollment(req, res, uid, factorId);
  }

  @Post(':uid/mfa/enroll/:factorId/confirm')
  @HttpCode(200)
  @Public()
  @RateLimit('auth')
  @ApiOperation({
    summary: '互動中的設定：確認驗證碼；回傳備用碼（只出現這一次）與要頂層跳轉的 resume 網址',
  })
  @ApiZodBody(ConfirmMfaEnrollmentSchema)
  @ApiZodResponse(200, MfaInteractionEnrollmentResultSchema)
  confirmEnrollment(
    @Param('uid', InteractionUidPipe) uid: string,
    @Param('factorId', ParseUUIDPipe) factorId: string,
    @Body(new ZodValidationPipe(ConfirmMfaEnrollmentSchema)) dto: ConfirmMfaEnrollmentDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.login.confirmEnrollment(req, res, uid, factorId, dto);
  }
}
