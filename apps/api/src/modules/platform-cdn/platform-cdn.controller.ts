import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequirePlatformPermissions } from '@/common/decorators';
import type { AuthUser } from '@/common/types';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import { CdnManualPurgeService } from './cdn-manual-purge.service';
import {
  CdnCheckResultSchema,
  CdnOverviewSchema,
  CdnPurgeRequestSchema,
  CdnPurgeResultSchema,
  UpdateCdnSettingsSchema,
} from './dto/platform-cdn.dto';
import type { CdnPurgeRequestDto, UpdateCdnSettingsDto } from './dto/platform-cdn.dto';
import { PlatformCdnSettingsService } from './platform-cdn-settings.service';

/**
 * CDN 的執行期設定、邊緣檢查與手動清理（apps/platform 的 `/cdn`，docs/architecture/backend/09-file.md §16.9～§16.12）。
 * 租戶網域上回 `PLATFORM_ONLY`。
 */
@ApiTags('platform-cdn')
@Controller('platform/cdn')
export class PlatformCdnController {
  constructor(
    private readonly settings: PlatformCdnSettingsService,
    private readonly purges: CdnManualPurgeService,
  ) {}

  @Get()
  @RequirePlatformPermissions('cdn:read')
  @ApiOperation({ summary: '部署資訊、存放的設定與生效值、最近一次檢查、最近的清理' })
  @ApiZodResponse(200, CdnOverviewSchema)
  overview() {
    return this.settings.overview();
  }

  @Put('settings')
  @RequirePlatformPermissions('cdn:update')
  @ApiOperation({
    summary:
      '執行期的開關與參數：只帶要改的欄位與 version，null 回到跟著環境變數；開啟或加入資源類型前必須通過節點檢查',
  })
  @ApiZodBody(UpdateCdnSettingsSchema)
  @ApiZodResponse(200, CdnOverviewSchema)
  update(
    @Body(new ZodValidationPipe(UpdateCdnSettingsSchema)) dto: UpdateCdnSettingsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settings.update(dto, actor);
  }

  @Post('check')
  @HttpCode(200)
  @RequirePlatformPermissions('cdn:read')
  @ApiOperation({ summary: '執行邊緣的檢查（10 秒內重複呼叫回上一次的結果）' })
  @ApiZodResponse(200, CdnCheckResultSchema)
  check() {
    return this.settings.check();
  }

  @Post('purge')
  @HttpCode(202)
  @RequirePlatformPermissions('cdn:purge')
  @ApiOperation({
    summary:
      '手動清理：路徑、資源（解析出所有路徑）或整個快取（另要 cdn:purgeAll）；排入 cdn.purge',
  })
  @ApiZodBody(CdnPurgeRequestSchema)
  @ApiZodResponse(202, CdnPurgeResultSchema)
  purge(
    @Body(new ZodValidationPipe(CdnPurgeRequestSchema)) dto: CdnPurgeRequestDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.purges.purge(dto, actor);
  }
}
