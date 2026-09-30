import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';

import { CurrentUser, Public, RequireAnyPermission, RequireFeature } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import {
  CompleteFileUploadSchema,
  CreateFileUploadPartsSchema,
  CreateFileUploadSchema,
} from './dto/create-file-upload.dto';
import type {
  CompleteFileUploadDto,
  CreateFileUploadDto,
  CreateFileUploadPartsDto,
} from './dto/create-file-upload.dto';
import { MoveFileItemsResultSchema, MoveFileItemsSchema } from './dto/file-folder.dto';
import type { MoveFileItemsDto } from './dto/file-folder.dto';
import {
  FileListSchema,
  FileSchema,
  FileUploadPartsSchema,
  FileUploadPolicySchema,
  FileUploadSchema,
} from './dto/file.dto';
import { GetFileImageSchema, ImageVariantSchema } from './dto/get-file-image.dto';
import type { GetFileImageDto } from './dto/get-file-image.dto';
import { ListFileSchema } from './dto/list-file.dto';
import type { ListFileDto } from './dto/list-file.dto';
import { UpdateFileSchema } from './dto/update-file.dto';
import type { UpdateFileDto } from './dto/update-file.dto';
import { FileFolderService } from './file-folder.service';
import { FileImageService } from './file-image.service';
import { IMAGE_VARIANTS } from './file.constants';
import type { ImageVariant } from './file.constants';
import { FileService } from './file.service';

@ApiTags('files')
@Controller('files')
@RequireFeature('file')
export class FileController {
  constructor(
    private readonly fileService: FileService,
    private readonly fileImageService: FileImageService,
    private readonly folderService: FileFolderService,
  ) {}

  @Get()
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_READ)
  @ApiZodResponse(200, FileListSchema)
  list(
    @Query(new ZodValidationPipe(ListFileSchema)) query: ListFileDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fileService.list(query, actor);
  }

  // 宣告在 `:id` 之前：否則會被當成 id 交給 ParseUUIDPipe
  @Get('upload-policy')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_CREATE)
  @ApiOperation({ summary: '上傳前的檢查與切塊策略（大小上限、分塊門檻、每塊大小）' })
  @ApiZodResponse(200, FileUploadPolicySchema)
  getUploadPolicy() {
    return this.fileService.getUploadPolicy();
  }

  @Post()
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_CREATE)
  @ApiOperation({ summary: '登記上傳並取得直傳網址（完成後呼叫 complete）' })
  @ApiZodBody(CreateFileUploadSchema)
  @ApiZodResponse(201, FileUploadSchema)
  createUpload(
    @Body(new ZodValidationPipe(CreateFileUploadSchema)) dto: CreateFileUploadDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fileService.createUpload(dto, actor);
  }

  @Post('move')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_UPDATE)
  @HttpCode(200)
  @ApiOperation({ summary: '把檔案與資料夾移到另一個資料夾（targetFolderId 為 null 是根目錄）' })
  @ApiZodBody(MoveFileItemsSchema)
  @ApiZodResponse(200, MoveFileItemsResultSchema)
  move(
    @Body(new ZodValidationPipe(MoveFileItemsSchema)) dto: MoveFileItemsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.folderService.move(dto, actor);
  }

  @Post(':id/parts')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_CREATE)
  @HttpCode(200)
  @ApiOperation({ summary: '分塊上傳：取得指定各塊的直傳網址' })
  @ApiZodBody(CreateFileUploadPartsSchema)
  @ApiZodResponse(200, FileUploadPartsSchema)
  createUploadParts(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(CreateFileUploadPartsSchema)) dto: CreateFileUploadPartsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fileService.createUploadParts(id, dto, actor);
  }

  @Post(':id/complete')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_CREATE)
  @HttpCode(200)
  @ApiOperation({ summary: '確認直傳完成，檔案轉為 ready（分塊上傳要帶各塊的 ETag）' })
  @ApiZodBody(CompleteFileUploadSchema)
  @ApiZodResponse(200, FileSchema)
  completeUpload(
    @Param('id', ParseUUIDPipe) id: string,
    // 單次 PUT 上傳不帶 body（Express 5 此時 req.body 是 undefined）
    @Body(new ZodValidationPipe(CompleteFileUploadSchema.default({}))) dto: CompleteFileUploadDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fileService.completeUpload(id, dto, actor);
  }

  @Delete(':id/upload')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_CREATE)
  @HttpCode(204)
  @ApiOperation({ summary: '放棄上傳中的檔案：清掉已上傳的內容與分塊' })
  async abortUpload(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    await this.fileService.abortUpload(id, actor);
  }

  /**
   * 影像 API：`<img src>` 帶不了 access token，所以是 `@Public()`，改以網址簽章授權
   * （網址只從看得到該檔案的回應拿得到，docs/architecture/backend/09-file.md §5.4）。
   * 不限流：一頁的圖示預覽就有數十個請求，轉址又會被瀏覽器快取；格式轉換只在第一次發生。
   */
  @Get(':id/image/:variant')
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: '取得圖片的原圖／全螢幕預覽／圖示預覽（302 轉址到物件儲存）' })
  @ApiParam({ name: 'variant', enum: IMAGE_VARIANTS })
  @ApiResponse({ status: 302, description: '轉址到該版本、該格式的內容' })
  async getImage(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variant', new ZodValidationPipe(ImageVariantSchema)) variant: ImageVariant,
    @Query(new ZodValidationPipe(GetFileImageSchema)) query: GetFileImageDto,
    @Headers('accept') accept: string | undefined,
    @Res() res: Response,
  ) {
    const target = await this.fileImageService.resolve(id, variant, query, accept);
    // 轉址本身也快取：同一個時間窗內重抓列表，瀏覽器不必再問 api
    res
      .set({
        'Cache-Control': `private, max-age=${target.maxAge}`,
        Vary: 'Accept',
        'X-Content-Type-Options': 'nosniff',
      })
      .redirect(302, target.url);
  }

  @Get(':id')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_READ)
  @ApiZodResponse(200, FileSchema)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.fileService.findOne(id, actor);
  }

  @Patch(':id')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_UPDATE)
  @ApiZodBody(UpdateFileSchema)
  @ApiZodResponse(200, FileSchema)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateFileSchema)) dto: UpdateFileDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fileService.update(id, dto, actor);
  }

  @Delete(':id')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_DELETE)
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    await this.fileService.remove(id, actor);
  }
}
