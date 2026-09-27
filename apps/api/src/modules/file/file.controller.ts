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
import {
  ApiZodBody,
  ApiZodListResponse,
  ApiZodResponse,
  ZodValidationPipe,
} from '@/core/validation';

import { CreateFileUploadSchema } from './dto/create-file-upload.dto';
import type { CreateFileUploadDto } from './dto/create-file-upload.dto';
import { FileSchema, FileUploadSchema } from './dto/file.dto';
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
  @ApiZodListResponse(200, FileSchema)
  list(@Query(new ZodValidationPipe(ListFileSchema)) query: ListFileDto) {
    return this.fileService.list(query);
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

  @Post(':id/complete')
  @RequirePermissions(PERMISSION.FILE_CREATE)
  @HttpCode(200)
  @ApiOperation({ summary: '確認直傳完成，檔案轉為 ready' })
  @ApiZodResponse(200, FileSchema)
  completeUpload(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.fileService.completeUpload(id, actor);
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
