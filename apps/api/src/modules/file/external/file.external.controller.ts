import {
  Body,
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

import {
  CurrentUser,
  ExternalApi,
  RequireAnyPermission,
  RequireFeature,
} from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import {
  ExternalCompleteFileUploadSchema,
  ExternalCreateFileUploadPartsSchema,
  ExternalCreateFileUploadSchema,
  ExternalFileListSchema,
  ExternalFileSchema,
  ExternalFileUploadPartsSchema,
  ExternalFileUploadSchema,
  ExternalFolderListSchema,
  ListExternalFileSchema,
} from './file.external.dto';
import type {
  ExternalCompleteFileUploadDto,
  ExternalCreateFileUploadDto,
  ExternalCreateFileUploadPartsDto,
  ListExternalFileDto,
} from './file.external.dto';
import { FileExternalService } from './file.external.service';

/**
 * 對外 API 的檔案與資料夾（docs/architecture/06-external-api.md §9 T3）。權限宣告與內部 api 的同一組端點相同：
 * 能進檔案管理器（`file:access`）或持有對應的全域權限；資料夾上的等級由 service 判斷。
 * 上傳是直傳物件儲存：建立 → PUT 到回傳的網址（分塊時先取 parts）→ complete。
 */
@ApiTags('files')
@ExternalApi()
@RequireFeature('file')
@Controller('v1')
export class FileExternalController {
  constructor(private readonly files: FileExternalService) {}

  @Get('folders')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_READ)
  @ApiOperation({ summary: '看得到內容的資料夾（扁平）與能不能上傳' })
  @ApiZodResponse(200, ExternalFolderListSchema)
  listFolders(@CurrentUser() actor: AuthUser) {
    return this.files.listFolders(actor);
  }

  @Get('files')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_READ)
  @ApiOperation({ summary: '檔案列表：依建立時間由新到舊，以 nextCursor 取下一頁' })
  @ApiZodResponse(200, ExternalFileListSchema)
  listFiles(
    @Query(new ZodValidationPipe(ListExternalFileSchema)) query: ListExternalFileDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.files.listFiles(query, actor);
  }

  @Post('files')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_CREATE)
  @ApiOperation({ summary: '開始上傳：回傳直傳網址（單次）或分塊資訊' })
  @ApiZodBody(ExternalCreateFileUploadSchema)
  @ApiZodResponse(201, ExternalFileUploadSchema)
  createUpload(
    @Body(new ZodValidationPipe(ExternalCreateFileUploadSchema)) dto: ExternalCreateFileUploadDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.files.createUpload(dto, actor);
  }

  @Get('files/:id')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_READ)
  @ApiOperation({ summary: '檔案資訊與下載網址（網址有時效，過期再取一次）' })
  @ApiZodResponse(200, ExternalFileSchema)
  getFile(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.files.getFile(id, actor);
  }

  @Post('files/:id/parts')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_CREATE)
  @HttpCode(200)
  @ApiOperation({ summary: '分塊上傳：取得這些分塊的直傳網址（一次最多 100 塊）' })
  @ApiZodBody(ExternalCreateFileUploadPartsSchema)
  @ApiZodResponse(200, ExternalFileUploadPartsSchema)
  createUploadParts(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ExternalCreateFileUploadPartsSchema))
    dto: ExternalCreateFileUploadPartsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.files.createUploadParts(id, dto, actor);
  }

  @Post('files/:id/complete')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_CREATE)
  @HttpCode(200)
  @ApiOperation({ summary: '完成上傳；分塊上傳要帶每一塊的 ETag' })
  @ApiZodBody(ExternalCompleteFileUploadSchema)
  @ApiZodResponse(200, ExternalFileSchema)
  completeUpload(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ExternalCompleteFileUploadSchema.default({})))
    dto: ExternalCompleteFileUploadDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.files.completeUpload(id, dto, actor);
  }

  @Delete('files/:id/upload')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_CREATE)
  @HttpCode(204)
  @ApiOperation({ summary: '放棄還沒完成的上傳' })
  async abortUpload(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    await this.files.abortUpload(id, actor);
  }
}
