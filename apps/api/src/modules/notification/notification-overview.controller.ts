import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import { ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import { ListAllNotificationSchema, NotificationOverviewPageSchema } from './dto/notification.dto';
import type { ListAllNotificationDto } from './dto/notification.dto';
import { NotificationService } from './notification.service';

/**
 * 通知總覽：租戶內所有人的站內通知（docs/architecture/backend/19-announcement.md §9.2 D1、D2）。
 * 與自己的通知（`NotificationController`，只需要登入）分開，權限宣告才不會混在一起。
 */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationOverviewController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get('all')
  @RequirePermissions(PERMISSION.NOTIFICATION_READ)
  @ApiOperation({
    summary: '租戶內所有人的通知（新的在前，keyset 分頁；可依類型、收件人、觸發者、時間篩選）',
  })
  @ApiZodResponse(200, NotificationOverviewPageSchema)
  listAll(@Query(new ZodValidationPipe(ListAllNotificationSchema)) query: ListAllNotificationDto) {
    return this.notificationService.listAll(query);
  }
}
