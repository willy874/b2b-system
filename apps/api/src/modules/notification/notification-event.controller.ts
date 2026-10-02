import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import {
  NotificationEventListSchema,
  UpdateNotificationEventsSchema,
} from './dto/notification-event.dto';
import type { UpdateNotificationEventsDto } from './dto/notification-event.dto';
import { NotificationPolicyService } from './notification-policy.service';

/**
 * 事件管理：租戶層的通知政策（docs/architecture/backend/16-notification-event.md §4、docs/architecture/backend/16-notification-event.md §9.2 D9）。
 * 與系統設定同性質，沿用 `system:read`／`system:update`（D10）。
 */
@ApiTags('notifications')
@Controller('notification-events')
export class NotificationEventController {
  constructor(private readonly policy: NotificationPolicyService) {}

  @Get()
  @RequirePermissions(PERMISSION.SYSTEM_READ)
  @ApiOperation({ summary: '事件目錄與每個管道的生效值、預設值、是否覆寫' })
  @ApiZodResponse(200, NotificationEventListSchema)
  list() {
    return this.policy.list();
  }

  @Patch()
  @RequirePermissions(PERMISSION.SYSTEM_UPDATE)
  @ApiOperation({ summary: '開關事件的管道；enabled 為 null 代表還原預設' })
  @ApiZodBody(UpdateNotificationEventsSchema)
  @ApiZodResponse(200, NotificationEventListSchema)
  update(
    @Body(new ZodValidationPipe(UpdateNotificationEventsSchema)) dto: UpdateNotificationEventsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.policy.update(dto, actor);
  }
}
