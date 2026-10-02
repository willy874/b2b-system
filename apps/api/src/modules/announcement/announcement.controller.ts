import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequireFeature, RequirePermissions } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import {
  ApiZodBody,
  ApiZodListResponse,
  ApiZodResponse,
  ZodValidationPipe,
} from '@/core/validation';

import { AnnouncementService } from './announcement.service';
import {
  AnnouncementActionSchema,
  AnnouncementAudienceSchema,
  AnnouncementDispatchSchema,
  AnnouncementSchema,
  AnnouncementTriggerEventListSchema,
  AudiencePreviewSchema,
  CreateAnnouncementSchema,
  ListAnnouncementDispatchSchema,
  ListAnnouncementSchema,
  RecurrencePreviewRequestSchema,
  RecurrencePreviewSchema,
  UpdateAnnouncementSchema,
} from './dto/announcement.dto';
import type {
  AnnouncementActionDto,
  AnnouncementAudienceDto,
  CreateAnnouncementDto,
  ListAnnouncementDispatchDto,
  ListAnnouncementDto,
  RecurrencePreviewRequestDto,
  UpdateAnnouncementDto,
} from './dto/announcement.dto';

/** 公告與發送紀錄（docs/adr/0031-announcements.md D15、D20）。 */
@ApiTags('announcements')
@Controller('announcements')
@RequireFeature('announcement')
export class AnnouncementController {
  constructor(private readonly announcements: AnnouncementService) {}

  @Get()
  @RequirePermissions(PERMISSION.ANNOUNCEMENT_READ)
  @ApiZodListResponse(200, AnnouncementSchema)
  list(@Query(new ZodValidationPipe(ListAnnouncementSchema)) query: ListAnnouncementDto) {
    return this.announcements.list(query);
  }

  @Post()
  @RequirePermissions(PERMISSION.ANNOUNCEMENT_CREATE)
  @ApiOperation({ summary: '建立草稿' })
  @ApiZodBody(CreateAnnouncementSchema)
  @ApiZodResponse(201, AnnouncementSchema)
  create(
    @Body(new ZodValidationPipe(CreateAnnouncementSchema)) dto: CreateAnnouncementDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.announcements.create(dto, actor);
  }

  @Post('audience-preview')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.ANNOUNCEMENT_UPDATE)
  @ApiOperation({ summary: '受眾現在會解析成幾個人（不回名單）' })
  @ApiZodBody(AnnouncementAudienceSchema)
  @ApiZodResponse(200, AudiencePreviewSchema)
  previewAudience(
    @Body(new ZodValidationPipe(AnnouncementAudienceSchema)) dto: AnnouncementAudienceDto,
  ) {
    return this.announcements.previewAudience(dto);
  }

  @Get('trigger-events')
  @RequirePermissions(PERMISSION.ANNOUNCEMENT_READ)
  @ApiOperation({ summary: '可以訂的觸發點（事件點；所屬 feature 已啟用）' })
  @ApiZodResponse(200, AnnouncementTriggerEventListSchema)
  listTriggerEvents() {
    return { items: this.announcements.listTriggerEvents() };
  }

  @Post('recurrence-preview')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.ANNOUNCEMENT_UPDATE)
  @ApiOperation({ summary: '週期接下來的發送時間（最多 5 次，依租戶時區）' })
  @ApiZodBody(RecurrencePreviewRequestSchema)
  @ApiZodResponse(200, RecurrencePreviewSchema)
  previewRecurrence(
    @Body(new ZodValidationPipe(RecurrencePreviewRequestSchema)) dto: RecurrencePreviewRequestDto,
  ) {
    return this.announcements.previewRecurrence(dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.ANNOUNCEMENT_READ)
  @ApiZodResponse(200, AnnouncementSchema)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.announcements.findOne(id);
  }

  /** 草稿以外（排程中、暫停中）的公告，service 另外要求 `announcement:publish`；已完成的不能改。 */
  @Patch(':id')
  @RequirePermissions(PERMISSION.ANNOUNCEMENT_UPDATE)
  @ApiOperation({ summary: '修改標題、內文、受眾、時間；只影響之後的發送' })
  @ApiZodBody(UpdateAnnouncementSchema)
  @ApiZodResponse(200, AnnouncementSchema)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateAnnouncementSchema)) dto: UpdateAnnouncementDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.announcements.update(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(PERMISSION.ANNOUNCEMENT_DELETE)
  @ApiOperation({ summary: '刪除（進回收桶）；排程中的改成暫停' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    await this.announcements.remove(id, actor);
  }

  @Post(':id/restore')
  @RequireFeature('trash') // 還原屬於回收桶（docs/adr/0029-toggleable-platform-features.md D3）
  @HttpCode(200)
  @RequirePermissions(PERMISSION.ANNOUNCEMENT_DELETE)
  @ApiOperation({ summary: '還原刪除的公告（排程中的會是暫停，不會自己開始發）' })
  @ApiZodResponse(200, AnnouncementSchema)
  restore(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.announcements.restore(id, actor);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.ANNOUNCEMENT_PUBLISH)
  @ApiOperation({ summary: '送出草稿：立即發送，或在指定的時間發送' })
  @ApiZodBody(AnnouncementActionSchema)
  @ApiZodResponse(200, AnnouncementSchema)
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(AnnouncementActionSchema)) dto: AnnouncementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.announcements.publishAnnouncement(id, dto, actor);
  }

  @Post(':id/pause')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.ANNOUNCEMENT_PUBLISH)
  @ApiOperation({ summary: '暫停排程' })
  @ApiZodBody(AnnouncementActionSchema)
  @ApiZodResponse(200, AnnouncementSchema)
  pause(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(AnnouncementActionSchema)) dto: AnnouncementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.announcements.pause(id, dto, actor);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.ANNOUNCEMENT_PUBLISH)
  @ApiOperation({ summary: '恢復排程（指定的時間已經過去時不能恢復）' })
  @ApiZodBody(AnnouncementActionSchema)
  @ApiZodResponse(200, AnnouncementSchema)
  resume(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(AnnouncementActionSchema)) dto: AnnouncementActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.announcements.resume(id, dto, actor);
  }

  @Get(':id/dispatches')
  @RequirePermissions(PERMISSION.ANNOUNCEMENT_READ)
  @ApiOperation({ summary: '發送紀錄（新的在前；人數、已讀數、狀態）' })
  @ApiZodListResponse(200, AnnouncementDispatchSchema)
  listDispatches(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(ListAnnouncementDispatchSchema))
    query: ListAnnouncementDispatchDto,
  ) {
    return this.announcements.listDispatches(id, query);
  }

  @Post(':id/dispatches/:dispatchId/revoke')
  @HttpCode(200)
  @RequirePermissions(PERMISSION.ANNOUNCEMENT_PUBLISH)
  @ApiOperation({ summary: '撤回一次發送：刪除它的所有通知，發送紀錄保留' })
  @ApiZodResponse(200, AnnouncementDispatchSchema)
  revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dispatchId', ParseUUIDPipe) dispatchId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.announcements.revoke(id, dispatchId, actor);
  }
}
