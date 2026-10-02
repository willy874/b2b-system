import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Authenticated, CurrentUser } from '@/common/decorators';
import type { AuthUser } from '@/common/types';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import {
  NotificationPreferenceListSchema,
  UpdateNotificationPreferencesSchema,
} from './dto/notification-preference.dto';
import type { UpdateNotificationPreferencesDto } from './dto/notification-preference.dto';
import { NotificationPreferenceService } from './notification-preference.service';

/**
 * 自己的通知設定（docs/architecture/backend/16-notification-event.md §5、docs/architecture/backend/16-notification-event.md §9.2 D15）：
 * 只需要登入、只看得到改得到自己的；不寫稽核。
 */
@ApiTags('notifications')
@Controller('me/notification-preferences')
export class NotificationPreferenceController {
  constructor(private readonly preferences: NotificationPreferenceService) {}

  @Get()
  @Authenticated()
  @ApiOperation({ summary: '自己的通知設定：每個事件與管道的生效值、能不能調整' })
  @ApiZodResponse(200, NotificationPreferenceListSchema)
  list(@CurrentUser() actor: AuthUser) {
    return this.preferences.list(actor);
  }

  @Patch()
  @Authenticated()
  @ApiOperation({ summary: '開關自己的通知；enabled 為 null 代表跟著租戶' })
  @ApiZodBody(UpdateNotificationPreferencesSchema)
  @ApiZodResponse(200, NotificationPreferenceListSchema)
  update(
    @Body(new ZodValidationPipe(UpdateNotificationPreferencesSchema))
    dto: UpdateNotificationPreferencesDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.preferences.update(dto, actor);
  }
}
