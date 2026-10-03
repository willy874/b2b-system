import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Authenticated, CurrentUser } from '@/common/decorators';
import type { AuthUser } from '@/common/types';
import { ApiZodListResponse, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import {
  ListPlatformNotificationSchema,
  PlatformNotificationSchema,
  PlatformNotificationUnreadCountSchema,
} from './dto/platform-notification.dto';
import type { ListPlatformNotificationDto } from './dto/platform-notification.dto';
import { PlatformNotificationService } from './platform-notification.service';

/**
 * 平台管理者自己的站內通知（docs/architecture/backend/15-notification.md §6.2）。對象是自己，只需要登入；
 * 只在 apps/auth 的網域有效（`/platform/*`，租戶網域上回 `PLATFORM_ONLY`），那裡只接受平台管理者的 token。
 */
@ApiTags('platform-notifications')
@Controller('platform/notifications')
export class PlatformNotificationController {
  constructor(private readonly notifications: PlatformNotificationService) {}

  @Get()
  @Authenticated()
  @ApiOperation({ summary: '自己的通知（新的在前）；`unread=true` 只列未讀' })
  @ApiZodListResponse(200, PlatformNotificationSchema)
  list(
    @Query(new ZodValidationPipe(ListPlatformNotificationSchema))
    query: ListPlatformNotificationDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.notifications.list(actor.id, query);
  }

  @Get('unread-count')
  @Authenticated()
  @ApiOperation({ summary: '自己的未讀數（頂列的徽章）' })
  @ApiZodResponse(200, PlatformNotificationUnreadCountSchema)
  unreadCount(@CurrentUser() actor: AuthUser) {
    return this.notifications.unreadCount(actor.id);
  }

  @Post('read-all')
  @HttpCode(200)
  @Authenticated()
  @ApiOperation({ summary: '自己的通知全部標為已讀' })
  markAllRead(@CurrentUser() actor: AuthUser) {
    return this.notifications.markAllRead(actor.id);
  }

  @Post(':id/read')
  @HttpCode(200)
  @Authenticated()
  @ApiOperation({ summary: '標為已讀（已讀過的再標一次不算錯）' })
  markRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.notifications.markRead(actor.id, id);
  }
}
