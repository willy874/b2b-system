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

import { CurrentUser, RequirePermissions } from '@/common/decorators';
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
import {
  FileListSchema,
  FileSchema,
  FileUploadPartsSchema,
  FileUploadPolicySchema,
  FileUploadSchema,
} from './dto/file.dto';
import { ListFileSchema } from './dto/list-file.dto';
import type { ListFileDto } from './dto/list-file.dto';
import { UpdateFileSchema } from './dto/update-file.dto';
import type { UpdateFileDto } from './dto/update-file.dto';
import { FileService } from './file.service';

@ApiTags('files')
@Controller('files')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Get()
  @RequirePermissions(PERMISSION.FILE_READ)
  @ApiZodResponse(200, FileListSchema)
  list(@Query(new ZodValidationPipe(ListFileSchema)) query: ListFileDto) {
    return this.fileService.list(query);
  }

  // 宣告在 `:id` 之前：否則會被當成 id 交給 ParseUUIDPipe
  @Get('upload-policy')
  @RequirePermissions(PERMISSION.FILE_CREATE)
  @ApiOperation({ summary: '上傳前的檢查與切塊策略（大小上限、分塊門檻、每塊大小）' })
  @ApiZodResponse(200, FileUploadPolicySchema)
  getUploadPolicy() {
    return this.fileService.getUploadPolicy();
  }

  @Post()
  @RequirePermissions(PERMISSION.FILE_CREATE)
  @ApiOperation({ summary: '登記上傳並取得直傳網址（完成後呼叫 complete）' })
  @ApiZodBody(CreateFileUploadSchema)
  @ApiZodResponse(201, FileUploadSchema)
  createUpload(
    @Body(new ZodValidationPipe(CreateFileUploadSchema)) dto: CreateFileUploadDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fileService.createUpload(dto, actor);
  }

  @Post(':id/parts')
  @RequirePermissions(PERMISSION.FILE_CREATE)
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
  @RequirePermissions(PERMISSION.FILE_CREATE)
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
  @RequirePermissions(PERMISSION.FILE_CREATE)
  @HttpCode(204)
  @ApiOperation({ summary: '放棄上傳中的檔案：清掉已上傳的內容與分塊' })
  async abortUpload(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    await this.fileService.abortUpload(id, actor);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.FILE_READ)
  @ApiZodResponse(200, FileSchema)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.fileService.findOne(id, actor);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.FILE_UPDATE)
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
  @RequirePermissions(PERMISSION.FILE_DELETE)
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    await this.fileService.remove(id, actor);
  }
}
