import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Authenticated, CurrentUser } from '@/common/decorators';
import type { AuthUser } from '@/common/types';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import {
  CompleteImageUploadSchema,
  CreateImageFromSourceSchema,
  CreateImageUploadSchema,
  ImageAssetListSchema,
  ImageAssetSchema,
  ImageUploadSchema,
  ImageUsageListSchema,
  ListRecentImagesSchema,
} from './dto/image.dto';
import type {
  CompleteImageUploadDto,
  CreateImageFromSourceDto,
  CreateImageUploadDto,
  ListRecentImagesDto,
} from './dto/image.dto';
import { ImageAssetService } from './image-asset.service';

/**
 * 圖片資產（docs/architecture/backend/25-image.md §15）。全部只宣告 `@Authenticated()`：上傳本身不需要權限，
 * 能不能「用」由 consumer 儲存時的權限決定；從其他來源複製時，來源的 `resolve` 以呼叫者的身分讀取。
 * 不屬於任何可關閉的 feature：關掉檔案管理器，頭像照樣能上傳。
 */
@ApiTags('images')
@Controller('images')
export class ImageController {
  constructor(private readonly images: ImageAssetService) {}

  @Get('usages')
  @Authenticated()
  @ApiOperation({ summary: '每個使用圖片的地方的限制（大小、型別、最小尺寸、比例、尺寸）' })
  @ApiZodResponse(200, ImageUsageListSchema)
  listUsages() {
    return this.images.listUsages();
  }

  @Get('recent')
  @Authenticated()
  @ApiOperation({ summary: '最近使用：自己建立過的圖片（同一個內容只列一次，最多 30 張）' })
  @ApiZodResponse(200, ImageAssetListSchema)
  recent(
    @Query(new ZodValidationPipe(ListRecentImagesSchema)) query: ListRecentImagesDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.images.recent(query.usage, actor);
  }

  @Post()
  @Authenticated()
  @ApiOperation({ summary: '登記上傳並取得直傳網址（完成後呼叫 complete）' })
  @ApiZodBody(CreateImageUploadSchema)
  @ApiZodResponse(201, ImageUploadSchema)
  createUpload(
    @Body(new ZodValidationPipe(CreateImageUploadSchema)) dto: CreateImageUploadDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.images.createUpload(dto, actor);
  }

  @Post('from-source')
  @Authenticated()
  @ApiOperation({ summary: '從其他來源（檔案管理、圖片庫、最近使用）複製成一張新的圖片' })
  @ApiZodBody(CreateImageFromSourceSchema)
  @ApiZodResponse(201, ImageAssetSchema)
  createFromSource(
    @Body(new ZodValidationPipe(CreateImageFromSourceSchema)) dto: CreateImageFromSourceDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.images.createFromSource(dto, actor);
  }

  @Post(':id/complete')
  @Authenticated()
  @HttpCode(200)
  @ApiOperation({ summary: '確認直傳完成並排入處理（可一併帶裁切）' })
  @ApiZodBody(CompleteImageUploadSchema)
  @ApiZodResponse(200, ImageAssetSchema)
  completeUpload(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(CompleteImageUploadSchema.default({}))) dto: CompleteImageUploadDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.images.completeUpload(id, dto, actor);
  }

  @Post(':id/hide-from-recent')
  @Authenticated()
  @HttpCode(204)
  @ApiOperation({ summary: '從最近使用移除（不影響正在使用它的地方）' })
  async hideFromRecent(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    await this.images.hideFromRecent(id, actor);
  }

  @Get(':id')
  @Authenticated()
  @ApiOperation({ summary: '自己建立的一張圖片（處理狀態、各尺寸的網址）' })
  @ApiZodResponse(200, ImageAssetSchema)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.images.findOwn(id, actor);
  }
}
