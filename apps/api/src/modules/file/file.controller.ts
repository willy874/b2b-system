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

import {
  CurrentUser,
  CurrentWorkspace,
  RequireAnyPermission,
  WorkspaceScoped,
} from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { AuthUser, WorkspaceScope } from '@/common/types';
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
import { ListFileSchema } from './dto/list-file.dto';
import type { ListFileDto } from './dto/list-file.dto';
import { UpdateFileSchema } from './dto/update-file.dto';
import type { UpdateFileDto } from './dto/update-file.dto';
import { FileFolderService } from './file-folder.service';
import { FileService } from './file.service';

@ApiTags('files')
@WorkspaceScoped()
@Controller('workspaces/:workspaceId/files')
export class FileController {
  constructor(
    private readonly fileService: FileService,
    private readonly folderService: FileFolderService,
  ) {}

  @Get()
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_READ)
  @ApiZodResponse(200, FileListSchema)
  list(
    @Query(new ZodValidationPipe(ListFileSchema)) query: ListFileDto,
    @CurrentWorkspace() ws: WorkspaceScope,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fileService.list(ws, query, actor);
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
    @CurrentWorkspace() ws: WorkspaceScope,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fileService.createUpload(ws, dto, actor);
  }

  @Post('move')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_UPDATE)
  @HttpCode(200)
  @ApiOperation({ summary: '把檔案與資料夾移到另一個資料夾（targetFolderId 為 null 是根目錄）' })
  @ApiZodBody(MoveFileItemsSchema)
  @ApiZodResponse(200, MoveFileItemsResultSchema)
  move(
    @Body(new ZodValidationPipe(MoveFileItemsSchema)) dto: MoveFileItemsDto,
    @CurrentWorkspace() ws: WorkspaceScope,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.folderService.move(ws, dto, actor);
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
    @CurrentWorkspace() ws: WorkspaceScope,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fileService.createUploadParts(ws, id, dto, actor);
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
    @CurrentWorkspace() ws: WorkspaceScope,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fileService.completeUpload(ws, id, dto, actor);
  }

  @Delete(':id/upload')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_CREATE)
  @HttpCode(204)
  @ApiOperation({ summary: '放棄上傳中的檔案：清掉已上傳的內容與分塊' })
  async abortUpload(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspace() ws: WorkspaceScope,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.fileService.abortUpload(ws, id, actor);
  }

  @Get(':id')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_READ)
  @ApiZodResponse(200, FileSchema)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspace() ws: WorkspaceScope,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fileService.findOne(ws, id, actor);
  }

  @Patch(':id')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_UPDATE)
  @ApiZodBody(UpdateFileSchema)
  @ApiZodResponse(200, FileSchema)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateFileSchema)) dto: UpdateFileDto,
    @CurrentWorkspace() ws: WorkspaceScope,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.fileService.update(ws, id, dto, actor);
  }

  @Delete(':id')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_DELETE)
  @HttpCode(204)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspace() ws: WorkspaceScope,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.fileService.remove(ws, id, actor);
  }
}
