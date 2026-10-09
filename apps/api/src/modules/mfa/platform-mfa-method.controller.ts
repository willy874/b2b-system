import { Body, Controller, Delete, Get, Param, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentUser, RequirePlatformPermissions } from '@/common/decorators';
import type { AuthUser } from '@/common/types';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import {
  MfaMethodImpactQuerySchema,
  MfaMethodImpactSchema,
  MfaMethodSettingsSchema,
  PlatformMfaMethodListSchema,
  PlatformMfaMethodSchema,
  UpdateMfaMethodSettingsSchema,
  UpdatePlatformMfaMethodSchema,
} from './dto/mfa.dto';
import type {
  MfaMethodImpactQueryDto,
  UpdateMfaMethodSettingsDto,
  UpdatePlatformMfaMethodDto,
} from './dto/mfa.dto';
import { PlatformMfaMethodService } from './platform-mfa-method.service';

const MethodIdPipe = new ZodValidationPipe(z.string().regex(/^[a-z][a-zA-Z0-9]*$/));

/** MFA 方式的平台開關（docs/architecture/backend/21-mfa.md §5）：apps/platform 的 `/mfa-method`。 */
@ApiTags('platform-mfa-methods')
@Controller('platform/mfa-methods')
export class PlatformMfaMethodController {
  constructor(private readonly methods: PlatformMfaMethodService) {}

  @Get()
  @RequirePlatformPermissions('mfaMethod:read')
  @ApiOperation({ summary: '驗證方式、全平台狀態、覆寫的租戶數、已設定的因子數' })
  @ApiZodResponse(200, PlatformMfaMethodListSchema)
  list() {
    return this.methods.list();
  }

  @Get(':id/impact')
  @RequirePlatformPermissions('mfaMethod:read')
  @ApiOperation({ summary: '關掉這個方式會被擋在門外的人數（全平台或指定租戶）' })
  @ApiZodResponse(200, MfaMethodImpactSchema)
  impact(
    @Param('id', MethodIdPipe) id: string,
    @Query(new ZodValidationPipe(MfaMethodImpactQuerySchema)) query: MfaMethodImpactQueryDto,
  ) {
    return this.methods.impact(id, query.tenantId);
  }

  @Get(':id/settings')
  @RequirePlatformPermissions('mfaMethod:read')
  @ApiOperation({ summary: '方式的平台參數（機密欄位只回傳有沒有設定）' })
  @ApiZodResponse(200, MfaMethodSettingsSchema)
  getSettings(@Param('id', MethodIdPipe) id: string) {
    return this.methods.getSettings(id);
  }

  @Put(':id/settings')
  @RequirePlatformPermissions('mfaMethod:update')
  @ApiOperation({
    summary: '儲存方式的平台參數：必填、格式與方式自己的檢查（例：以金鑰呼叫供應商）全部通過才寫入',
  })
  @ApiZodBody(UpdateMfaMethodSettingsSchema)
  @ApiZodResponse(200, MfaMethodSettingsSchema)
  saveSettings(
    @Param('id', MethodIdPipe) id: string,
    @Body(new ZodValidationPipe(UpdateMfaMethodSettingsSchema)) dto: UpdateMfaMethodSettingsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.methods.saveSettings(id, dto, actor);
  }

  @Delete(':id/settings')
  @RequirePlatformPermissions('mfaMethod:update')
  @ApiOperation({ summary: '刪除方式的平台參數（方式還開著時拒絕）' })
  @ApiZodResponse(200, MfaMethodSettingsSchema)
  clearSettings(@Param('id', MethodIdPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.methods.clearSettings(id, actor);
  }

  @Put(':id')
  @RequirePlatformPermissions('mfaMethod:update')
  @ApiOperation({ summary: '全平台層的開關：on／off（緊急關閉，蓋過租戶層）／default' })
  @ApiZodBody(UpdatePlatformMfaMethodSchema)
  @ApiZodResponse(200, PlatformMfaMethodSchema)
  update(
    @Param('id', MethodIdPipe) id: string,
    @Body(new ZodValidationPipe(UpdatePlatformMfaMethodSchema)) dto: UpdatePlatformMfaMethodDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.methods.update(id, dto, actor);
  }
}
