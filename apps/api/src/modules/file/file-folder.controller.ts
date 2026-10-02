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

import { CurrentUser, RequireAnyPermission, RequireFeature } from '@/common/decorators';
import { PERMISSION } from '@/common/types';
import type { AuthUser } from '@/common/types';
import { ApiZodBody, ApiZodResponse, ZodValidationPipe } from '@/core/validation';

import {
  CreateFileFolderSchema,
  EnsureFileFolderPathsSchema,
  FileFolderListSchema,
  FileFolderPathsSchema,
  FileFolderSchema,
  RestoredFileFolderSchema,
  UpdateFileFolderSchema,
} from './dto/file-folder.dto';
import type {
  CreateFileFolderDto,
  EnsureFileFolderPathsDto,
  UpdateFileFolderDto,
} from './dto/file-folder.dto';
import { FileFolderService } from './file-folder.service';

/**
 * 檔案管理器的資料夾（docs/architecture/backend/09-file.md §4.2）。沿用檔案的權限：
 * 建立（含上傳資料夾）＝ create、改名 ＝ update、遞迴刪除 ＝ delete。
 * 閘門是 `file:access` 或全域 `file:<動作>`，資料夾範圍由 service 判斷（§11）。
 * 移動檔案與資料夾是 `POST /files/move`。
 */
@ApiTags('files')
@Controller('file-folders')
@RequireFeature('file')
export class FileFolderController {
  constructor(private readonly folderService: FileFolderService) {}

  @Get()
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_READ)
  @ApiOperation({ summary: '全部的資料夾（扁平清單，前端自行組成樹）' })
  @ApiZodResponse(200, FileFolderListSchema)
  list(@CurrentUser() actor: AuthUser) {
    return this.folderService.list(actor);
  }

  @Post()
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_CREATE)
  @ApiZodBody(CreateFileFolderSchema)
  @ApiZodResponse(201, FileFolderSchema)
  create(
    @Body(new ZodValidationPipe(CreateFileFolderSchema)) dto: CreateFileFolderDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.folderService.create(dto, actor);
  }

  @Post('paths')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_CREATE)
  @HttpCode(200)
  @ApiOperation({
    summary: '上傳資料夾：確保各路徑存在（同名的資料夾沿用），回傳各路徑的資料夾 id',
  })
  @ApiZodBody(EnsureFileFolderPathsSchema)
  @ApiZodResponse(200, FileFolderPathsSchema)
  ensurePaths(
    @Body(new ZodValidationPipe(EnsureFileFolderPathsSchema)) dto: EnsureFileFolderPathsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.folderService.ensurePaths(dto, actor);
  }

  @Patch(':id')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_UPDATE)
  @ApiZodBody(UpdateFileFolderSchema)
  @ApiZodResponse(200, FileFolderSchema)
  rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateFileFolderSchema)) dto: UpdateFileFolderDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.folderService.rename(id, dto, actor);
  }

  @Delete(':id')
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_DELETE)
  @HttpCode(204)
  @ApiOperation({ summary: '遞迴刪除資料夾：子資料夾與其中的檔案一起刪除' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    await this.folderService.remove(id, actor);
  }

  /**
   * 還原刪除的資料夾與同一次刪除的子資料夾、檔案（docs/architecture/backend/14-revisions.md §9.2 D5、D10）。閘門與刪除相同；以還原後的結構照刪除的規則檢查。
   * 上層已刪除 409 `FILE_FOLDER_RESTORE_CONFLICT`；同名 409 `FILE_FOLDER_NAME_CONFLICT`（`details.conflictingId`）。
   */
  @Post(':id/restore')
  @RequireFeature('trash') // 還原屬於回收桶（docs/architecture/05-tenancy.md §12.2 D3）
  @RequireAnyPermission(PERMISSION.FILE_ACCESS, PERMISSION.FILE_DELETE)
  @HttpCode(200)
  @ApiOperation({ summary: '還原刪除的資料夾（同一次刪除的子資料夾與檔案一併還原）' })
  @ApiZodResponse(200, RestoredFileFolderSchema)
  restore(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.folderService.restore(id, actor);
  }
}
