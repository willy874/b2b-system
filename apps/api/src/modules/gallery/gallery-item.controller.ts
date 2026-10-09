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
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import {
  CreateGalleryFromSourceSchema,
  CreateGalleryUploadSchema,
  GalleryFromSourceResultSchema,
  GalleryItemDetailSchema,
  GalleryItemListSchema,
  GalleryNeighborsQuerySchema,
  GalleryNeighborsSchema,
  GalleryTimelineQuerySchema,
  GalleryTimelineSchema,
  GalleryUploadItemSchema,
  GalleryUploadSchema,
  GalleryUploadStatusSchema,
  ListGalleryItemsSchema,
  UpdateGalleryItemSchema,
} from './dto/gallery-item.dto';
import type {
  CreateGalleryFromSourceDto,
  CreateGalleryUploadDto,
  GalleryNeighborsQueryDto,
  GalleryTimelineQueryDto,
  ListGalleryItemsDto,
  UpdateGalleryItemDto,
} from './dto/gallery-item.dto';
import { GalleryItemService } from './gallery-item.service';

/**
 * 圖片庫的圖片（docs/architecture/backend/26-gallery.md）。可由平台關閉（`gallery`）：停用時整個 controller 回 404。
 * 授權只有 RBAC（D4）：`gallery:read` 看得到整個圖片庫。
 */
@ApiTags('gallery')
@Controller('gallery/items')
@RequireFeature('gallery')
export class GalleryItemController {
  constructor(private readonly service: GalleryItemService) {}

  @Get()
  @RequirePermissions(PERMISSION.GALLERY_READ)
  @ApiOperation({
    summary: '圖片（keyset 分頁；篩選：關鍵字、相簿、標籤、日期、方向、上傳者、來源）',
  })
  @ApiZodResponse(200, GalleryItemListSchema)
  list(@Query(new ZodValidationPipe(ListGalleryItemsSchema)) query: ListGalleryItemsDto) {
    return this.service.list(query);
  }

  // 宣告在 `:id` 之前：否則會被當成 id 交給 ParseUUIDPipe
  @Get('timeline')
  @RequirePermissions(PERMISSION.GALLERY_READ)
  @ApiOperation({ summary: '每個月的張數（日期捲軸）' })
  @ApiZodResponse(200, GalleryTimelineSchema)
  timeline(
    @Query(new ZodValidationPipe(GalleryTimelineQuerySchema)) query: GalleryTimelineQueryDto,
  ) {
    return this.service.timeline(query);
  }

  @Get('uploads')
  @RequirePermissions(PERMISSION.GALLERY_CREATE)
  @ApiOperation({ summary: '自己上傳中與處理失敗的圖片' })
  @ApiZodResponse(200, GalleryUploadStatusSchema)
  uploads(@CurrentUser() actor: AuthUser) {
    return this.service.uploads(actor);
  }

  @Delete('uploads/failed')
  @RequirePermissions(PERMISSION.GALLERY_CREATE)
  @HttpCode(204)
  @ApiOperation({ summary: '清掉自己處理失敗的紀錄' })
  async clearFailed(@CurrentUser() actor: AuthUser) {
    await this.service.clearFailed(actor);
  }

  @Post()
  @RequirePermissions(PERMISSION.GALLERY_CREATE)
  @ApiOperation({ summary: '登記上傳並取得直傳網址（完成後呼叫 complete）' })
  @ApiZodBody(CreateGalleryUploadSchema)
  @ApiZodResponse(201, GalleryUploadSchema)
  createUpload(
    @Body(new ZodValidationPipe(CreateGalleryUploadSchema)) dto: CreateGalleryUploadDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.service.createUpload(dto, actor);
  }

  @Post('from-source')
  @RequirePermissions(PERMISSION.GALLERY_CREATE)
  @HttpCode(200)
  @ApiOperation({ summary: '從其他來源（檔案管理…）複製加入；逐筆回報加入或略過的原因' })
  @ApiZodBody(CreateGalleryFromSourceSchema)
  @ApiZodResponse(200, GalleryFromSourceResultSchema)
  createFromSource(
    @Body(new ZodValidationPipe(CreateGalleryFromSourceSchema)) dto: CreateGalleryFromSourceDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.service.createFromSource(dto, actor);
  }

  @Post(':id/complete')
  @RequirePermissions(PERMISSION.GALLERY_CREATE)
  @HttpCode(200)
  @ApiOperation({ summary: '確認直傳完成並排入處理' })
  @ApiZodResponse(200, GalleryUploadItemSchema)
  completeUpload(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.service.completeUpload(id, actor);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.GALLERY_READ)
  @ApiOperation({ summary: '一張圖片的詳情（EXIF、相簿、重複、原檔與下載的網址）' })
  @ApiZodResponse(200, GalleryItemDetailSchema)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/neighbors')
  @RequirePermissions(PERMISSION.GALLERY_READ)
  @ApiOperation({ summary: '同一個篩選與排序之下的前一張與後一張' })
  @ApiZodResponse(200, GalleryNeighborsSchema)
  neighbors(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(GalleryNeighborsQuerySchema)) query: GalleryNeighborsQueryDto,
  ) {
    return this.service.neighbors(id, query);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.GALLERY_UPDATE)
  @ApiOperation({ summary: '編輯標題、說明、顯示方向（樂觀鎖）' })
  @ApiZodBody(UpdateGalleryItemSchema)
  @ApiZodResponse(200, GalleryItemDetailSchema)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateGalleryItemSchema)) dto: UpdateGalleryItemDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.service.update(id, dto, actor);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSION.GALLERY_DELETE)
  @HttpCode(204)
  @ApiOperation({ summary: '刪除（移到回收桶）' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    await this.service.remove(id, actor);
  }

  @Post(':id/restore')
  @RequireFeature('trash') // 還原屬於回收桶（docs/architecture/05-tenancy.md §12.2 D3）
  @HttpCode(200)
  @RequirePermissions(PERMISSION.GALLERY_DELETE)
  @ApiOperation({ summary: '還原刪除的圖片（相簿的關聯一併恢復）' })
  @ApiZodResponse(200, GalleryItemDetailSchema)
  restore(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.service.restore(id, actor);
  }
}
