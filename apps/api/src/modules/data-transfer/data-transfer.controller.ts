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
  Res,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { Authenticated, CurrentUser, RequireFeature } from '@/common/decorators';
import type { AuthUser } from '@/common/types';
import { NoStore } from '@/core/http';
import { contentDisposition } from '@/core/storage';
import {
  ApiZodBody,
  ApiZodListResponse,
  ApiZodResponse,
  ZodValidationPipe,
} from '@/core/validation';

import { RequestPreference } from './data-transfer.context';
import type { ClientPreference } from './data-transfer.context';
import {
  ImportUploadInterceptor,
  RequestContentLength,
  UploadedImportFile,
} from './data-transfer.http';
import type { UploadedSheet } from './data-transfer.http';
import { DataTransferService } from './data-transfer.service';
import {
  AnalyzeImportSchema,
  CancelDataTransferSchema,
  CreateExportSchema,
  CreateImportSchema,
  DataTransferDownloadSchema,
  DataTransferSchema,
  ImportAnalysisSchema,
  ImportColumnListSchema,
  ImportColumnsQuerySchema,
  ListDataTransferSchema,
  ListTransferRowsSchema,
  ReferenceOptionListSchema,
  ReferenceOptionsQuerySchema,
  TargetOptionListSchema,
  ReportQuerySchema,
  TemplateQuerySchema,
  TransferApplyRowListSchema,
  TransferResourceListSchema,
  ValidateImportResultSchema,
  ValidateImportSchema,
} from './dto/data-transfer.dto';
import type {
  AnalyzeImportDto,
  CancelDataTransferDto,
  CreateExportDto,
  CreateImportDto,
  ImportColumnsQueryDto,
  ListDataTransferDto,
  ListTransferRowsDto,
  ReferenceOptionsQueryDto,
  ReportQueryDto,
  TemplateQueryDto,
  ValidateImportDto,
} from './dto/data-transfer.dto';
import { DataTransferImportService } from './import/data-transfer-import.service';
import type { SheetFile } from './import/data-transfer-import.service';

function sendFile(res: Response, file: SheetFile): void {
  res
    .set({
      'Content-Type': file.contentType,
      'Content-Disposition': contentDisposition('attachment', file.fileName),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    .send(file.body);
}

/**
 * 匯入／匯出（docs/architecture/backend/22-data-transfer.md §4.2）。所有路由都只要登入：
 * 依資源而定的權限在 service 以 `assertHasAll` 檢查（寫 `authz.denied`，與 `@RequirePermissions` 效果相同），
 * 傳輸只能操作自己建立的。
 */
@ApiTags('data-transfers')
@Controller('data-transfers')
@RequireFeature('dataTransfer')
export class DataTransferController {
  constructor(
    private readonly transfers: DataTransferService,
    private readonly imports: DataTransferImportService,
  ) {}

  @Get()
  @Authenticated()
  @ApiOperation({ summary: '我的匯入匯出' })
  @ApiZodListResponse(200, DataTransferSchema)
  list(
    @Query(new ZodValidationPipe(ListDataTransferSchema)) query: ListDataTransferDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.transfers.list(query, actor);
  }

  @Get('resources')
  @Authenticated()
  @ApiOperation({ summary: '操作者可以匯出或匯入的資源類型，以及各自可用的欄位與格式' })
  @ApiZodResponse(200, TransferResourceListSchema)
  resources(@CurrentUser() actor: AuthUser, @RequestPreference() preference: ClientPreference) {
    return this.transfers.resources(actor, preference);
  }

  @Post('exports')
  @Authenticated()
  @HttpCode(202)
  @ApiOperation({ summary: '建立匯出：背景組裝檔案，完成後以 POST /:id/download 取得下載連結' })
  @ApiZodBody(CreateExportSchema)
  @ApiZodResponse(202, DataTransferSchema)
  createExport(
    @Body(new ZodValidationPipe(CreateExportSchema)) dto: CreateExportDto,
    @CurrentUser() actor: AuthUser,
    @RequestPreference() preference: ClientPreference,
  ) {
    return this.transfers.createExport(dto, actor, preference);
  }

  @Post('imports')
  @Authenticated()
  @HttpCode(202)
  @ApiOperation({ summary: '套用匯入：寫入套用列並在背景重新驗證、逐列套用' })
  @ApiZodBody(CreateImportSchema)
  @ApiZodResponse(202, DataTransferSchema)
  createImport(
    @Body(new ZodValidationPipe(CreateImportSchema)) dto: CreateImportDto,
    @CurrentUser() actor: AuthUser,
    @RequestPreference() preference: ClientPreference,
    @RequestContentLength() contentLength: number,
  ) {
    return this.imports.createImport(dto, actor, preference, contentLength);
  }

  @Get('importers/:type')
  @Authenticated()
  @ApiOperation({ summary: '匯入的欄位定義（依請求的語系）' })
  @ApiZodResponse(200, ImportColumnListSchema)
  importColumns(
    @Param('type') type: string,
    @Query(new ZodValidationPipe(ImportColumnsQuerySchema)) query: ImportColumnsQueryDto,
    @CurrentUser() actor: AuthUser,
    @RequestPreference() preference: ClientPreference,
  ) {
    return this.imports.columns(type, query.mode, actor, preference);
  }

  @Get('importers/:type/template')
  @Authenticated()
  @NoStore()
  @ApiOperation({ summary: '下載範本（修改模式預先填入現有資料）' })
  @ApiProduces(
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/json',
    'application/yaml',
  )
  @ApiResponse({ status: 200, description: '範本檔' })
  async template(
    @Param('type') type: string,
    @Query(new ZodValidationPipe(TemplateQuerySchema)) query: TemplateQueryDto,
    @CurrentUser() actor: AuthUser,
    @RequestPreference() preference: ClientPreference,
    @Res() res: Response,
  ): Promise<void> {
    sendFile(res, await this.imports.template(type, query, actor, preference));
  }

  @Get('importers/:type/columns/:key/options')
  @Authenticated()
  @ApiOperation({
    summary: '預覽中的選項：reference 欄位的下拉選單，或文字欄的自動完成（欄位有 suggest 時）',
  })
  @ApiZodResponse(200, ReferenceOptionListSchema)
  referenceOptions(
    @Param('type') type: string,
    @Param('key') key: string,
    @Query(new ZodValidationPipe(ReferenceOptionsQuerySchema)) query: ReferenceOptionsQueryDto,
    @CurrentUser() actor: AuthUser,
    @RequestPreference() preference: ClientPreference,
  ) {
    return this.imports.options(type, key, query.keyword, actor, preference);
  }

  @Get('importers/:type/targets')
  @Authenticated()
  @ApiOperation({ summary: '修改模式：手動指定比對目標的下拉選單（關鍵字搜尋）' })
  @ApiZodResponse(200, TargetOptionListSchema)
  targetOptions(
    @Param('type') type: string,
    @Query(new ZodValidationPipe(ReferenceOptionsQuerySchema)) query: ReferenceOptionsQueryDto,
    @CurrentUser() actor: AuthUser,
    @RequestPreference() preference: ClientPreference,
  ) {
    return this.imports.targets(type, query.keyword, actor, preference);
  }

  @Post('importers/:type/analyze')
  @Authenticated()
  @HttpCode(200)
  @UseInterceptors(ImportUploadInterceptor)
  @ApiOperation({
    summary: '分析：上傳 CSV／XLSX／JSON／YAML，轉成 JSON 並逐列驗證（不保存任何資料）',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'mode'],
      properties: {
        file: { type: 'string', format: 'binary' },
        mode: { type: 'string', enum: ['create', 'update'] },
        encoding: { type: 'string', enum: ['auto', 'utf-8', 'big5', 'utf-16'] },
        sheet: { type: 'string' },
        mapping: { type: 'string', description: '`{ 來源欄序號: columnKey | null }` 的 JSON 字串' },
      },
    },
  })
  @ApiZodResponse(200, ImportAnalysisSchema)
  analyze(
    @Param('type') type: string,
    @Body(new ZodValidationPipe(AnalyzeImportSchema)) dto: AnalyzeImportDto,
    @UploadedImportFile() file: UploadedSheet,
    @CurrentUser() actor: AuthUser,
    @RequestPreference() preference: ClientPreference,
  ) {
    return this.imports.analyze(type, dto, file, actor, preference);
  }

  @Post('importers/:type/validate')
  @Authenticated()
  @HttpCode(200)
  @ApiOperation({ summary: '驗證改過的列（無狀態；最多 1 000 列）' })
  @ApiZodBody(ValidateImportSchema)
  @ApiZodResponse(200, ValidateImportResultSchema)
  validate(
    @Param('type') type: string,
    @Body(new ZodValidationPipe(ValidateImportSchema)) dto: ValidateImportDto,
    @CurrentUser() actor: AuthUser,
    @RequestPreference() preference: ClientPreference,
  ) {
    return this.imports.validate(type, dto, actor, preference);
  }

  @Get(':id')
  @Authenticated()
  @ApiZodResponse(200, DataTransferSchema)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.transfers.findOne(id, actor);
  }

  @Post(':id/cancel')
  @Authenticated()
  @HttpCode(200)
  @ApiOperation({ summary: '取消進行中的傳輸（帶 version）' })
  @ApiZodBody(CancelDataTransferSchema)
  @ApiZodResponse(200, DataTransferSchema)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(CancelDataTransferSchema)) dto: CancelDataTransferDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.transfers.cancel(id, dto, actor);
  }

  @Delete(':id')
  @Authenticated()
  @HttpCode(204)
  @ApiOperation({ summary: '刪除已結束的傳輸：立即刪除檔案與套用列（不影響任何業務資料）' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    await this.transfers.remove(id, actor);
  }

  @Post(':id/download')
  @Authenticated()
  @HttpCode(200)
  @NoStore()
  @ApiOperation({ summary: '取得匯出檔的下載連結（每次重新簽發，並重新檢查匯出權限；寫稽核）' })
  @ApiZodResponse(200, DataTransferDownloadSchema)
  download(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.transfers.download(id, actor);
  }

  @Get(':id/rows')
  @Authenticated()
  @ApiOperation({ summary: '匯入的套用列與結果（keyset：afterRowNo）' })
  @ApiZodResponse(200, TransferApplyRowListSchema)
  rows(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(ListTransferRowsSchema)) query: ListTransferRowsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.transfers.rows(id, query, actor);
  }

  @Get(':id/report')
  @Authenticated()
  @NoStore()
  @ApiOperation({ summary: '下載匯入的結果報告（原本的欄位加上列號、結果、錯誤）' })
  @ApiProduces('text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiResponse({ status: 200, description: '結果報告' })
  async report(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(ReportQuerySchema)) query: ReportQueryDto,
    @CurrentUser() actor: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    sendFile(res, await this.imports.report(id, query, actor));
  }
}
