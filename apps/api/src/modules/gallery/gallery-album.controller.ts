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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, RequireFeature, RequirePermissions } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import {
  CreateGalleryAlbumSchema,
  GalleryAlbumItemsResultSchema,
  GalleryAlbumItemsSchema,
  GalleryAlbumListSchema,
  GalleryAlbumSchema,
  UpdateGalleryAlbumSchema,
} from './dto/gallery-album.dto';
import type {
  CreateGalleryAlbumDto,
  GalleryAlbumItemsDto,
  UpdateGalleryAlbumDto,
} from './dto/gallery-album.dto';
import { GalleryAlbumService } from './gallery-album.service';

/** 圖片庫的相簿（docs/architecture/backend/26-gallery.md §7）。相簿頁就是套了 `albumId` 的圖片列表。 */
@ApiTags('gallery')
@Controller('gallery/albums')
@RequireFeature('gallery')
export class GalleryAlbumController {
  constructor(private readonly service: GalleryAlbumService) {}

  @Get()
  @RequirePermissions(PERMISSION.GALLERY_READ)
  @ApiOperation({ summary: '相簿（封面、名稱、張數）' })
  @ApiZodResponse(200, GalleryAlbumListSchema)
  list() {
    return this.service.list();
  }

  @Post()
  @RequirePermissions(PERMISSION.GALLERY_CREATE)
  @ApiZodBody(CreateGalleryAlbumSchema)
  @ApiZodResponse(201, GalleryAlbumSchema)
  create(
    @Body(new ZodValidationPipe(CreateGalleryAlbumSchema)) dto: CreateGalleryAlbumDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.service.create(dto, actor);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.GALLERY_READ)
  @ApiZodResponse(200, GalleryAlbumSchema)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.GALLERY_UPDATE)
  @ApiOperation({ summary: '改名、說明、封面（樂觀鎖）' })
  @ApiZodBody(UpdateGalleryAlbumSchema)
  @ApiZodResponse(200, GalleryAlbumSchema)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateGalleryAlbumSchema)) dto: UpdateGalleryAlbumDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.service.update(id, dto, actor);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSION.GALLERY_DELETE)
  @HttpCode(204)
  @ApiOperation({ summary: '刪除相簿（移到回收桶；圖片不刪）' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    await this.service.remove(id, actor);
  }

  @Post(':id/restore')
  @RequireFeature('trash') // 還原屬於回收桶（docs/architecture/05-tenancy.md §12.2 D3）
  @HttpCode(200)
  @RequirePermissions(PERMISSION.GALLERY_DELETE)
  @ApiOperation({ summary: '還原刪除的相簿' })
  @ApiZodResponse(200, GalleryAlbumSchema)
  restore(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.service.restore(id, actor);
  }

  @Post(':id/items')
  @RequirePermissions(PERMISSION.GALLERY_UPDATE)
  @HttpCode(200)
  @ApiOperation({ summary: '加入圖片（已經在的略過）' })
  @ApiZodBody(GalleryAlbumItemsSchema)
  @ApiZodResponse(200, GalleryAlbumItemsResultSchema)
  addItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(GalleryAlbumItemsSchema)) dto: GalleryAlbumItemsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.service.addItems(id, dto, actor);
  }

  @Post(':id/items/remove')
  @RequirePermissions(PERMISSION.GALLERY_UPDATE)
  @HttpCode(200)
  @ApiOperation({ summary: '移出圖片（圖片本身不刪）' })
  @ApiZodBody(GalleryAlbumItemsSchema)
  @ApiZodResponse(200, GalleryAlbumItemsResultSchema)
  removeItems(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(GalleryAlbumItemsSchema)) dto: GalleryAlbumItemsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.service.removeItems(id, dto, actor);
  }
}
