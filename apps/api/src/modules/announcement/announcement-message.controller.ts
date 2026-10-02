import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Authenticated, CurrentUser, RequireFeature } from '@/common/decorators';
import type { AuthUser } from '@/common/types';
import { ApiZodResponse } from '@/core/validation';

import { AnnouncementService } from './announcement.service';
import { AnnouncementMessageSchema } from './dto/announcement.dto';

/**
 * 收件人讀公告全文（docs/architecture/backend/19-announcement.md §9.2 D4）：只需要登入，只看得到自己收到的。
 * 與管理端分開，權限宣告才不會混在一起。
 */
@ApiTags('announcements')
@Controller('me/announcement-messages')
@RequireFeature('announcement')
export class AnnouncementMessageController {
  constructor(private readonly announcements: AnnouncementService) {}

  @Get(':dispatchId')
  @Authenticated()
  @ApiOperation({ summary: '自己收到的公告全文；同時把那則通知標為已讀' })
  @ApiZodResponse(200, AnnouncementMessageSchema)
  read(@Param('dispatchId', ParseUUIDPipe) dispatchId: string, @CurrentUser() actor: AuthUser) {
    return this.announcements.readMessage(dispatchId, actor);
  }
}
