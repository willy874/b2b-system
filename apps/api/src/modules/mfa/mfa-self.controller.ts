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

import { Authenticated, CurrentUser } from '@/common/decorators';
import { RateLimit } from '@/common/rate-limit';
import type { AuthUser } from '@/common/types';
import { AppException } from '@/core/errors';
import { isPlatformHostRequest, NoStore } from '@/core/http';
import type { MfaRealm } from '@/core/mfa';
import { currentTenant } from '@/core/tenant';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import {
  ConfirmMfaEnrollmentSchema,
  MfaChallengeInfoSchema,
  MfaEnrollmentResultSchema,
  MfaEnrollmentSchema,
  MfaOverviewSchema,
  MfaPasswordConfirmSchema,
  MfaRecoveryCodesSchema,
  StartMfaEnrollmentSchema,
} from './dto/mfa.dto';
import type {
  ConfirmMfaEnrollmentDto,
  MfaPasswordConfirmDto,
  StartMfaEnrollmentDto,
} from './dto/mfa.dto';
import { MfaService } from './mfa.service';

/**
 * 自助管理（docs/architecture/backend/21-mfa.md §7）的端點；租戶（`/auth/mfa`）與平台（`/platform/auth/mfa`）
 * 各一個 controller，行為相同。新增、移除因子都不撤銷其他 session；移除與重新產生備用碼要再輸入密碼。
 */
abstract class MfaSelfEndpoints {
  protected abstract readonly realm: MfaRealm;

  constructor(protected readonly mfa: MfaService) {}

  /** 平台的端點只在 apps/platform 的網域、沒有租戶時存在；租戶的端點要有租戶。 */
  protected assertRealm(): void {
    const platform = !currentTenant() && isPlatformHostRequest();
    if (this.realm === 'platform' ? !platform : !currentTenant()) {
      throw new AppException(this.realm === 'platform' ? 'PLATFORM_ONLY' : 'TENANT_NOT_FOUND');
    }
  }

  @Get()
  @Authenticated()
  @ApiOperation({ summary: '我的驗證方式、剩餘備用碼、可以設定的方式' })
  @ApiZodResponse(200, MfaOverviewSchema)
  overview(@CurrentUser() actor: AuthUser) {
    this.assertRealm();
    return this.mfa.overview(this.realm, actor.id);
  }

  @Post('factors')
  @HttpCode(200)
  @Authenticated()
  @RateLimit('authMail')
  @ApiOperation({ summary: '開始設定一種驗證方式（Email 會同時寄出驗證碼）' })
  @ApiZodBody(StartMfaEnrollmentSchema)
  @ApiZodResponse(200, MfaEnrollmentSchema)
  startEnrollment(
    @Body(new ZodValidationPipe(StartMfaEnrollmentSchema)) dto: StartMfaEnrollmentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    this.assertRealm();
    return this.mfa.startEnrollment(this.realm, actor.id, dto.method);
  }

  @Post('factors/:id/challenge')
  @HttpCode(200)
  @Authenticated()
  @RateLimit('authMail')
  @ApiOperation({ summary: '設定中：重寄驗證碼' })
  @ApiZodResponse(200, MfaChallengeInfoSchema)
  resend(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    this.assertRealm();
    return this.mfa.resendChallenge(this.realm, actor.id, id, 'enroll');
  }

  @Post('factors/:id/confirm')
  @HttpCode(200)
  @Authenticated()
  @RateLimit('auth')
  @ApiOperation({ summary: '確認設定；第一個因子同時產生備用碼（只出現這一次）' })
  @ApiZodBody(ConfirmMfaEnrollmentSchema)
  @ApiZodResponse(200, MfaEnrollmentResultSchema)
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ConfirmMfaEnrollmentSchema)) dto: ConfirmMfaEnrollmentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    this.assertRealm();
    return this.mfa.confirmEnrollment(this.realm, actor.id, id, dto);
  }

  @Delete('factors/:id')
  @Authenticated()
  @RateLimit('auth')
  @ApiOperation({ summary: '移除一個驗證方式（要再輸入密碼）；全部移除時備用碼一起刪' })
  @ApiZodBody(MfaPasswordConfirmSchema)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(MfaPasswordConfirmSchema)) dto: MfaPasswordConfirmDto,
    @CurrentUser() actor: AuthUser,
  ) {
    this.assertRealm();
    return this.mfa.removeFactor(this.realm, actor.id, id, dto.password);
  }

  @Post('recovery-codes')
  @HttpCode(200)
  @Authenticated()
  @RateLimit('auth')
  @ApiOperation({ summary: '重新產生備用碼（要再輸入密碼），舊的全部作廢' })
  @ApiZodBody(MfaPasswordConfirmSchema)
  @ApiZodResponse(200, MfaRecoveryCodesSchema)
  regenerateRecoveryCodes(
    @Body(new ZodValidationPipe(MfaPasswordConfirmSchema)) dto: MfaPasswordConfirmDto,
    @CurrentUser() actor: AuthUser,
  ) {
    this.assertRealm();
    return this.mfa.regenerateRecoveryCodes(this.realm, actor.id, dto.password);
  }
}

@ApiTags('auth')
@Controller('auth/mfa')
@NoStore()
export class MfaSelfController extends MfaSelfEndpoints {
  protected readonly realm = 'tenant' as const;

  // 每個子類別都要宣告建構式：Nest 從被裝飾的類別讀建構式的參數型別，抽象的基底沒有這份 metadata
  constructor(mfa: MfaService) {
    super(mfa);
  }
}

@ApiTags('platform-auth')
@Controller('platform/auth/mfa')
@NoStore()
export class PlatformMfaSelfController extends MfaSelfEndpoints {
  protected readonly realm = 'platform' as const;

  constructor(mfa: MfaService) {
    super(mfa);
  }
}
