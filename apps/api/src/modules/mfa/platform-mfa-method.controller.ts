import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { CurrentUser, RequirePlatformPermissions } from '@/common/decorators';
import type { AuthUser } from '@/common/types';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import {
  MfaMethodImpactQuerySchema,
  MfaMethodImpactSchema,
  PlatformMfaMethodListSchema,
  PlatformMfaMethodSchema,
  UpdatePlatformMfaMethodSchema,
} from './dto/mfa.dto';
import type { MfaMethodImpactQueryDto, UpdatePlatformMfaMethodDto } from './dto/mfa.dto';
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
