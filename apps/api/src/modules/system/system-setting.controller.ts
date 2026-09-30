import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, Public, RequirePermissions } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import {
  PublicSystemSettingsSchema,
  SystemSettingListSchema,
  UpdateSystemSettingsSchema,
} from './dto/system-setting.dto';
import type { UpdateSystemSettingsDto } from './dto/system-setting.dto';
import { SystemSettingService } from './system-setting.service';

/** 執行期可調的設定（docs/architecture/backend/12-settings.md §4）。 */
@ApiTags('system')
@Controller('system/settings')
export class SystemSettingController {
  constructor(private readonly settings: SystemSettingService) {}

  @Get()
  @RequirePermissions(PERMISSION.SYSTEM_READ)
  @ApiOperation({ summary: '所有設定：生效值、預設值、是否覆寫、允許範圍' })
  @ApiZodResponse(200, SystemSettingListSchema)
  list() {
    return this.settings.list();
  }

  @Get('public')
  @Public()
  @ApiOperation({ summary: '公開設定（登入前就要用的，例如是否開放註冊）' })
  @ApiZodResponse(200, PublicSystemSettingsSchema)
  listPublic() {
    return this.settings.listPublic();
  }

  @Patch()
  @RequirePermissions(PERMISSION.SYSTEM_UPDATE)
  @ApiOperation({ summary: '修改多個設定；值為 null 代表還原預設' })
  @ApiZodBody(UpdateSystemSettingsSchema)
  @ApiZodResponse(200, SystemSettingListSchema)
  update(
    @Body(new ZodValidationPipe(UpdateSystemSettingsSchema)) dto: UpdateSystemSettingsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settings.update(dto, actor);
  }
}
