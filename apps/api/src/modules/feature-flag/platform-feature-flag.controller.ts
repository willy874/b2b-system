import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequirePlatformPermissions } from '@/common/decorators';
import type { AuthUser } from '@/common/types';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import {
  FeatureFlagListSchema,
  FeatureFlagSchema,
  UpdateFeatureFlagSchema,
} from './dto/feature-flag.dto';
import type { UpdateFeatureFlagDto } from './dto/feature-flag.dto';
import { PlatformFeatureFlagService } from './platform-feature-flag.service';

/**
 * 平台管理者的 feature flag（apps/auth，docs/architecture/05-tenancy.md §11.2 D8）：目錄與全平台層的覆寫。
 * 租戶網域上回 `PLATFORM_ONLY`。
 */
@ApiTags('platform-feature-flags')
@Controller('platform/feature-flags')
export class PlatformFeatureFlagController {
  constructor(private readonly flags: PlatformFeatureFlagService) {}

  @Get()
  @RequirePlatformPermissions('featureFlag:read')
  @ApiOperation({ summary: 'feature flag 的目錄、全平台覆寫與覆寫它的租戶數' })
  @ApiZodResponse(200, FeatureFlagListSchema)
  list() {
    return this.flags.list();
  }

  @Put(':key')
  @RequirePlatformPermissions('featureFlag:update')
  @ApiOperation({
    summary: '全平台層的覆寫：on（全面開放）、off（緊急關閉，蓋過租戶層）、default（移除覆寫）',
  })
  @ApiZodBody(UpdateFeatureFlagSchema)
  @ApiZodResponse(200, FeatureFlagSchema)
  update(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(UpdateFeatureFlagSchema)) dto: UpdateFeatureFlagDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.flags.update(key, dto, actor);
  }
}
