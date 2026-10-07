import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Authenticated, CurrentUser } from '@/common/decorators';
import type { AuthUser } from '@/common/types';
import { ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import {
  ListNotificationSchema,
  NotificationPageSchema,
  NotificationReadAllResultSchema,
  NotificationSchema,
  NotificationUnreadCountSchema,
} from './dto/notification.dto';
import type { ListNotificationDto } from './dto/notification.dto';
import { NotificationService } from './notification.service';

/**
 * 自己的站內通知（docs/architecture/backend/15-notification.md §12.2 D9）：只需要登入、不新增權限鍵；每個端點都只看得到、改得到自己的。
 * 已讀與刪除不寫稽核。
 */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @Authenticated()
  @ApiOperation({ summary: '自己的通知（新的在前，keyset 分頁；unread=true 只列未讀）' })
  @ApiZodResponse(200, NotificationPageSchema)
  list(
    @Query(new ZodValidationPipe(ListNotificationSchema)) query: ListNotificationDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.notificationService.list(query, actor);
  }

  @Get('unread-count')
  @Authenticated()
  @ApiOperation({ summary: '自己的未讀通知數' })
  @ApiZodResponse(200, NotificationUnreadCountSchema)
  unreadCount(@CurrentUser() actor: AuthUser) {
    return this.notificationService.unreadCount(actor);
  }

  @Post('read-all')
  @HttpCode(200)
  @Authenticated()
  @ApiOperation({ summary: '自己所有未讀的通知標為已讀' })
  @ApiZodResponse(200, NotificationReadAllResultSchema)
  readAll(@CurrentUser() actor: AuthUser) {
    return this.notificationService.markAllRead(actor);
  }

  /** 不是自己的與不存在的一樣回 404 `NOTIFICATION_NOT_FOUND`。 */
  @Post(':id/read')
  @HttpCode(200)
  @Authenticated()
  @ApiOperation({ summary: '一則通知標為已讀' })
  @ApiZodResponse(200, NotificationSchema)
  read(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.notificationService.markRead(id, actor);
  }

  /**
   * 自己刪掉一則（不進回收桶）。不是自己的與不存在的一樣回 404 `NOTIFICATION_NOT_FOUND`。
   * 公告的通知刪掉後就看不到全文，發送紀錄的人數與已讀率也少算這一則——與保留清理刪除時相同。
   */
  @Delete(':id')
  @HttpCode(204)
  @Authenticated()
  @ApiOperation({ summary: '刪除一則自己的通知' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    await this.notificationService.remove(id, actor);
  }
}
