import { ChangeKind } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { TENANT_DB, withTransaction } from '@/core/database';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import { JobQueue } from '@/core/jobs';
import { dataTransferBytes } from '@/core/metrics';
import {
  DATA_TRANSFER_IMPORT_MAX_ROWS_PARAM,
  DATA_TRANSFER_IMPORT_MAX_SIZE_MB_PARAM,
  tenantFeatureParam,
} from '@/core/tenant';

import { DataTransferRegistry } from '../data-transfer-registry.service';
import { importColumnSets, isReadable, toImportColumnView } from '../data-transfer.columns';
import type { AnyColumn } from '../data-transfer.columns';
import {
  DATA_TRANSFER_HINT_MAX_OPTIONS,
  DATA_TRANSFER_MAX_ACTIVE_PER_USER,
  DATA_TRANSFER_SAMPLE_ROWS,
  DATA_TRANSFER_TEMPLATE_SAMPLES,
  REFERENCE_SEARCH_LIMIT,
} from '../data-transfer.constants';
import { DataTransferContextFactory } from '../data-transfer.context';
import type { ClientPreference } from '../data-transfer.context';
import type { UploadedSheet } from '../data-transfer.http';
import { DATA_TRANSFER_APPLY_IMPORT_JOB } from '../data-transfer.job-types';
import { DataTransferLifecycle, toTransferDto } from '../data-transfer.lifecycle';
import { DataTransferRepository } from '../data-transfer.repository';
import type {
  AnyTransferResource,
  ImportMode,
  LocalizedText,
  SheetFormat,
  TransferContext,
  TransferLocale,
} from '../data-transfer.types';
import { escapeFormula, normalizeText, toCellText } from '../data-transfer.values';
import type {
  AnalyzeImportDto,
  CreateImportDto,
  DataTransferDto,
  ImportAnalysis,
  ReportQueryDto,
  TemplateQueryDto,
  ValidateImportDto,
} from '../dto/data-transfer.dto';
import { mapHeaders, parseMappingParam, toCells } from './header-mapping';
import { ImportValidator } from './import-validator';
import { ParsePool } from './parse-pool';
import { buildCsv, buildXlsx, SHEET_CONTENT_TYPE } from './sheet-files';
import type { SheetData } from './sheet-files';

const MIB = 1024 * 1024;

/** 結果報告多出的三欄；重新上傳時以 `knownReadOnly` 自動忽略。 */
const REPORT_COLUMNS = {
  row: { 'zh-TW': '列號', 'en-US': 'Row' },
  outcome: { 'zh-TW': '結果', 'en-US': 'Result' },
  error: { 'zh-TW': '錯誤', 'en-US': 'Error' },
} as const satisfies Record<string, LocalizedText>;
const REPORT_HEADERS: ReadonlySet<string> = new Set(
  Object.values(REPORT_COLUMNS).flatMap((label) => Object.values(label).map(normalizeText)),
);

const OUTCOME_LABEL: Readonly<Record<string, LocalizedText>> = {
  pending: { 'zh-TW': '未處理', 'en-US': 'Pending' },
  succeeded: { 'zh-TW': '成功', 'en-US': 'Succeeded' },
  failed: { 'zh-TW': '失敗', 'en-US': 'Failed' },
  skipped: { 'zh-TW': '略過', 'en-US': 'Skipped' },
  cancelled: { 'zh-TW': '已取消', 'en-US': 'Cancelled' },
};

const KIND_LABEL: Readonly<Record<AnyColumn['kind'], LocalizedText>> = {
  string: { 'zh-TW': '文字', 'en-US': 'Text' },
  number: { 'zh-TW': '數字', 'en-US': 'Number' },
  boolean: { 'zh-TW': '是／否', 'en-US': 'Yes / No' },
  date: { 'zh-TW': '日期（YYYY-MM-DD）', 'en-US': 'Date (YYYY-MM-DD)' },
  datetime: { 'zh-TW': '日期時間（ISO 8601）', 'en-US': 'Date and time (ISO 8601)' },
  enum: { 'zh-TW': '選項', 'en-US': 'Option' },
  reference: { 'zh-TW': '名稱', 'en-US': 'Name' },
  json: { 'zh-TW': 'JSON', 'en-US': 'JSON' },
};

const GUIDE_HEADER = {
  'zh-TW': ['欄位', '必填', '格式', '可用的選項', '說明'],
  'en-US': ['Column', 'Required', 'Format', 'Options', 'Notes'],
} as const satisfies Record<TransferLocale, readonly string[]>;
const GUIDE_SHEET: LocalizedText = { 'zh-TW': '欄位說明', 'en-US': 'Columns' };
const MULTI_HINT: LocalizedText = { 'zh-TW': '多個值以 ; 分隔', 'en-US': 'Separate values with ;' };
const YES_NO: Readonly<Record<TransferLocale, readonly [string, string]>> = {
  'zh-TW': ['是', ''],
  'en-US': ['Yes', ''],
};

export interface SheetFile {
  fileName: string;
  contentType: string;
  body: Buffer;
}

function sheetFormatOf(fileName: string): SheetFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) return 'csv';
  return null;
}

/**
 * 匯入的 API（docs/architecture/backend/22-data-transfer.md §7）：分析與驗證是無狀態的請求（D21），
 * 送出套用時才建立傳輸並寫入套用列，由 `dataTransfer.applyImport` 在背景重新驗證後逐列套用。
 */
@Injectable()
export class DataTransferImportService {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: DataTransferRepository,
    private readonly registry: DataTransferRegistry,
    private readonly contexts: DataTransferContextFactory,
    private readonly lifecycle: DataTransferLifecycle,
    private readonly validator: ImportValidator,
    private readonly pool: ParsePool,
    private readonly jobs: JobQueue,
  ) {}

  /** 資源類型存在、支援這個模式，而且操作者有這個模式的權限。 */
  private async prepare(
    type: string,
    mode: ImportMode,
    actor: AuthUser,
    preference: ClientPreference,
    route: string,
  ): Promise<{ resource: AnyTransferResource; ctx: TransferContext }> {
    const resource = this.registry.require(type, 'import', mode);
    const permissions = resource.importer?.modes[mode]?.permissions ?? [];
    await this.contexts.assertHasAll(actor, permissions, route);
    return { resource, ctx: await this.contexts.forRequest(actor, preference) };
  }

  async columns(type: string, mode: ImportMode, actor: AuthUser, preference: ClientPreference) {
    const { resource, ctx } = await this.prepare(
      type,
      mode,
      actor,
      preference,
      'GET /data-transfers/importers/:type',
    );
    const sets = importColumnSets(resource, mode, ctx);
    return {
      items: sets.importable.map((column) =>
        toImportColumnView(resource, column, mode, ctx.locale),
      ),
      readOnly: sets.readOnly
        .filter((column) => isReadable(column, ctx))
        .map((column) => ({ key: column.key, label: column.label[ctx.locale] })),
    };
  }

  /** 範本（§7.2 步驟 2）：只含可匯入的欄位；修改模式預先填入最多 10 筆現有資料。XLSX 另附欄位說明的工作表。 */
  async template(
    type: string,
    query: TemplateQueryDto,
    actor: AuthUser,
    preference: ClientPreference,
  ): Promise<SheetFile> {
    const { resource, ctx } = await this.prepare(
      type,
      query.mode,
      actor,
      preference,
      'GET /data-transfers/importers/:type/template',
    );
    const columns = importColumnSets(resource, query.mode, ctx).importable;
    const header = columns.map((column) => column.label[ctx.locale]);
    let rows: string[][] = [];
    if (query.mode === 'update' && resource.importer?.sampleRecords) {
      const records = await resource.importer.sampleRecords(ctx, DATA_TRANSFER_TEMPLATE_SAMPLES);
      rows = records.map((record) =>
        columns.map((column) => toCellText(column, column.export?.get(record), ctx)),
      );
    } else if (columns.some((column) => column.example)) {
      rows = [columns.map((column) => column.example ?? '')];
    }
    const fileName = `${resource.fileBaseName}-template-${query.mode}.${query.format}`;
    const data: SheetData = { name: resource.label[ctx.locale], header, rows };
    if (query.format === 'csv') {
      const escaped = rows.map((row) =>
        row.map((text, index) => {
          const column = columns[index];
          return column ? escapeFormula(column, text) : text;
        }),
      );
      return {
        fileName,
        contentType: SHEET_CONTENT_TYPE.csv,
        body: buildCsv({ ...data, rows: escaped }),
      };
    }
    const guide: SheetData = {
      name: GUIDE_SHEET[ctx.locale],
      header: GUIDE_HEADER[ctx.locale],
      rows: columns.map((column) => {
        const options = column.enum ?? [];
        return [
          column.label[ctx.locale],
          query.mode === 'create' && column.import?.requiredOnCreate
            ? YES_NO[ctx.locale][0]
            : YES_NO[ctx.locale][1],
          KIND_LABEL[column.kind][ctx.locale],
          options.length && options.length <= DATA_TRANSFER_HINT_MAX_OPTIONS
            ? options.map((option) => option.label[ctx.locale]).join('、')
            : '',
          [column.hint?.[ctx.locale], column.multiple ? MULTI_HINT[ctx.locale] : null]
            .filter(Boolean)
            .join(' '),
        ];
      }),
    };
    return { fileName, contentType: SHEET_CONTENT_TYPE.xlsx, body: await buildXlsx([data, guide]) };
  }

  /** `reference` 欄位的搜尋（預覽中的下拉選單）。 */
  async options(
    type: string,
    key: string,
    keyword: string,
    actor: AuthUser,
    preference: ClientPreference,
  ) {
    const resource = this.registry.require(type, 'import');
    const ctx = await this.contexts.forRequest(actor, preference);
    const column = resource.columns.find((item) => item.key === key);
    const mode = (['create', 'update'] as const).find(
      (item) =>
        column?.import?.modes.includes(item) &&
        resource.importer?.modes[item]?.permissions.every((permission) => ctx.can(permission)),
    );
    if (!column?.reference || !mode) {
      throw new AppException('VALIDATION_FAILED', { fields: { column: key } });
    }
    if (!importColumnSets(resource, mode, ctx).importable.includes(column)) {
      throw new AppException('AUTHZ_FORBIDDEN', {
        missing: [column.import?.permission ?? column.permission],
      });
    }
    const items = await column.reference.search(keyword, ctx);
    return { items: items.slice(0, REFERENCE_SEARCH_LIMIT) };
  }

  /**
   * 分析（§7.3）：檔案在 worker thread 解析成二維字串陣列 → 標頭對應 → 轉成 JSON → 同一個驗證器逐列驗證。
   * 超過列數上限不截斷（匯入前 N 列會讓人以為全部都匯入了）。
   */
  async analyze(
    type: string,
    dto: AnalyzeImportDto,
    file: UploadedSheet,
    actor: AuthUser,
    preference: ClientPreference,
  ): Promise<ImportAnalysis> {
    const { resource, ctx } = await this.prepare(
      type,
      dto.mode,
      actor,
      preference,
      'POST /data-transfers/importers/:type/analyze',
    );
    const maxBytes = tenantFeatureParam(DATA_TRANSFER_IMPORT_MAX_SIZE_MB_PARAM) * MIB;
    if (file.size > maxBytes) throw new AppException('DATA_TRANSFER_FILE_TOO_LARGE', { maxBytes });
    const format = sheetFormatOf(file.originalname);
    if (!format) throw new AppException('DATA_TRANSFER_FILE_UNREADABLE', { reason: 'format' });
    const parsed = await this.pool.parse(new Uint8Array(file.buffer), {
      format,
      encoding: dto.encoding,
      ...(dto.sheet ? { sheet: dto.sheet } : {}),
    });
    dataTransferBytes.inc({ direction: 'import', format }, file.size);
    if (!parsed.ok)
      throw new AppException('DATA_TRANSFER_FILE_UNREADABLE', { reason: parsed.reason });
    const max = tenantFeatureParam(DATA_TRANSFER_IMPORT_MAX_ROWS_PARAM);
    if (parsed.rows.length > max) {
      throw new AppException('DATA_TRANSFER_TOO_MANY_ROWS', { max, count: parsed.rows.length });
    }

    const sets = importColumnSets(resource, dto.mode, ctx);
    const explicit = parseMappingParam(dto.mapping, parsed.header.length, sets.importable);
    const mapped = mapHeaders(parsed.header, sets, dto.mode, explicit, REPORT_HEADERS);
    const views = (columns: readonly AnyColumn[]) =>
      columns.map((column) => toImportColumnView(resource, column, dto.mode, ctx.locale));
    const fileName = file.originalname;
    if (!mapped.complete) {
      return {
        status: 'needsMapping',
        fileName,
        headers: mapped.headers.map(({ index, text, suggestion }) => ({ index, text, suggestion })),
        samples: parsed.rows.slice(0, DATA_TRANSFER_SAMPLE_ROWS).map((row) => row.cells),
        ignored: mapped.headers.flatMap((item) =>
          item.ignored ? [{ index: item.index, header: item.text, reason: item.ignored }] : [],
        ),
        columns: views(sets.importable),
        ...(parsed.sheets && parsed.sheets.length > 1 ? { sheets: parsed.sheets } : {}),
      };
    }

    const rows = parsed.rows.map((row, index) => ({
      rowNo: index + 1,
      sourceRow: row.sourceRow,
      cells: toCells(row.cells, mapped.mapping, mapped.columns),
    }));
    const validated = await this.validator.validate(resource, dto.mode, rows, ctx);
    // 沒有計算結果的公式儲存格視為空白並警告
    const bySourceRow = new Map(rows.map((row, index) => [row.sourceRow, index]));
    for (const warning of parsed.warnings) {
      const index = bySourceRow.get(warning.sourceRow);
      const key = mapped.mapping[warning.column];
      const row = index === undefined ? undefined : validated[index];
      if (row && key)
        row.issues.push({ column: key, code: 'formulaWithoutValue', severity: 'warning' });
    }
    return {
      status: 'ok',
      fileName,
      columns: views(mapped.columns),
      ignored: mapped.ignored,
      rows,
      results: validated.map((row) => this.validator.toResponse(row)),
      ...(parsed.sheets && parsed.sheets.length > 1 ? { sheets: parsed.sheets } : {}),
    };
  }

  /** 驗證改過的列（§7.4）：無狀態，重送沒有副作用。 */
  async validate(
    type: string,
    dto: ValidateImportDto,
    actor: AuthUser,
    preference: ClientPreference,
  ) {
    const { resource, ctx } = await this.prepare(
      type,
      dto.mode,
      actor,
      preference,
      'POST /data-transfers/importers/:type/validate',
    );
    const rows = await this.validator.validate(resource, dto.mode, dto.rows, ctx);
    return { rows: rows.map((row) => this.validator.toResponse(row)) };
  }

  /**
   * 送出套用（§7.6）：檢查權限與上限，在一個交易內建立傳輸、一次寫入全部套用列、入列套用工作。
   * 不在請求中驗證：5 000 列的完整驗證要數秒，交給工作做（工作一定重新驗證全部列，不信任前端的結果）。
   */
  async createImport(
    dto: CreateImportDto,
    actor: AuthUser,
    preference: ClientPreference,
    contentLength: number,
  ): Promise<DataTransferDto> {
    const { resource, ctx } = await this.prepare(
      dto.type,
      dto.mode,
      actor,
      preference,
      'POST /data-transfers/imports',
    );
    const maxBytes = tenantFeatureParam(DATA_TRANSFER_IMPORT_MAX_SIZE_MB_PARAM) * MIB * 2;
    if (contentLength > maxBytes)
      throw new AppException('DATA_TRANSFER_FILE_TOO_LARGE', { maxBytes });
    const max = tenantFeatureParam(DATA_TRANSFER_IMPORT_MAX_ROWS_PARAM);
    if (dto.rows.length > max)
      throw new AppException('DATA_TRANSFER_TOO_MANY_ROWS', { max, count: dto.rows.length });
    if (new Set(dto.rows.map((row) => row.rowNo)).size !== dto.rows.length) {
      throw new AppException('VALIDATION_FAILED', { fields: { rows: 'duplicate rowNo' } });
    }
    const importable = new Set(
      importColumnSets(resource, dto.mode, ctx).importable.map((column) => column.key),
    );
    const columns = [...new Set(dto.rows.flatMap((row) => Object.keys(row.cells)))];
    const unknown = columns.find((key) => !importable.has(key));
    if (unknown) throw new AppException('DATA_TRANSFER_MAPPING_INVALID', { column: unknown });

    const created = await withTransaction(this.db, async (tx) => {
      if ((await this.repo.countActive(actor.id, tx)) >= DATA_TRANSFER_MAX_ACTIVE_PER_USER) {
        throw new AppException('DATA_TRANSFER_LIMIT_EXCEEDED', {
          max: DATA_TRANSFER_MAX_ACTIVE_PER_USER,
        });
      }
      const transfer = await this.repo.create(
        {
          direction: 'import',
          type: resource.type,
          mode: dto.mode,
          format: dto.fileName && sheetFormatOf(dto.fileName) === 'xlsx' ? 'xlsx' : 'csv',
          status: 'queued',
          createdBy: actor.id,
          locale: ctx.locale,
          timezone: ctx.timezone,
          params: {
            skipInvalid: dto.skipInvalid,
            columns: resource.columns
              .filter((column) => columns.includes(column.key))
              .map((column) => column.key),
          },
          sourceName: dto.fileName ?? null,
          totalRows: dto.rows.length,
          expiresAt: this.lifecycle.pendingExpiresAt(),
        },
        tx,
      );
      await this.repo.insertRows(
        dto.rows.map((row) => ({
          transferId: transfer.id,
          rowNo: row.rowNo,
          sourceRow: row.sourceRow ?? null,
          raw: row.cells,
          targetId: row.target?.id ?? null,
          targetVersion: row.target?.version ?? null,
          targetExpected: row.target?.expected ?? null,
        })),
        tx,
      );
      await this.jobs.enqueue(DATA_TRANSFER_APPLY_IMPORT_JOB, { transferId: transfer.id }, { tx });
      return transfer;
    });
    this.lifecycle.publish(created, ChangeKind.CREATE);
    return toTransferDto(created);
  }

  /** 結果報告（§7.7）：原本的欄位加上「列號」「結果」「錯誤」，格式與範本相同，修正後可以直接重新上傳。 */
  async report(id: string, query: ReportQueryDto, actor: AuthUser): Promise<SheetFile> {
    const transfer = await this.repo.findById(id);
    // 別人的與不存在的一樣回 404（§9.1）
    if (!transfer || transfer.createdBy !== actor.id)
      throw new AppException('DATA_TRANSFER_NOT_FOUND');
    if (transfer.direction !== 'import') {
      throw new AppException('DATA_TRANSFER_INVALID_STATE', { status: transfer.status });
    }
    if (transfer.status === 'expired') throw new AppException('DATA_TRANSFER_EXPIRED');
    const resource = this.registry.require(transfer.type, 'import');
    const locale: TransferLocale = transfer.locale === 'en-US' ? 'en-US' : 'zh-TW';
    const keys = ((transfer.params as { columns?: string[] }).columns ?? []).filter((key) =>
      resource.columns.some((column) => column.key === key),
    );
    const columns = keys.map(
      (key) => resource.columns.find((column) => column.key === key) as AnyColumn,
    );
    const header = [
      ...columns.map((column) => column.label[locale]),
      REPORT_COLUMNS.row[locale],
      REPORT_COLUMNS.outcome[locale],
      REPORT_COLUMNS.error[locale],
    ];
    const rows: string[][] = [];
    let after: number | undefined;
    for (;;) {
      const page = await this.repo.listRows(transfer.id, {
        outcome: query.rows === 'failed' ? ['failed'] : undefined,
        afterRowNo: after,
        limit: 1000,
      });
      for (const row of page) {
        const cells = columns.map((column) => {
          const text = row.raw[column.key] ?? '';
          return query.format === 'csv' ? escapeFormula(column, text) : text;
        });
        rows.push([
          ...cells,
          String(row.sourceRow ?? row.rowNo),
          OUTCOME_LABEL[row.outcome]?.[locale] ?? row.outcome,
          describeError(row.outcomeError),
        ]);
      }
      if (page.length < 1000) break;
      after = page.at(-1)?.rowNo;
    }
    const base = (transfer.sourceName ?? `${resource.fileBaseName}-import`).replace(/\.[^.]+$/, '');
    const fileName = `${base}-result.${query.format}`;
    const data: SheetData = { name: resource.label[locale], header, rows };
    return query.format === 'csv'
      ? { fileName, contentType: SHEET_CONTENT_TYPE.csv, body: buildCsv(data) }
      : { fileName, contentType: SHEET_CONTENT_TYPE.xlsx, body: await buildXlsx([data]) };
  }
}

/**
 * 結果報告的「錯誤」欄：錯誤碼或問題代碼（`email: alreadyExists`）。後端沒有語系檔，畫面上的結果表由前端翻譯；
 * 報告是給人修正後重新上傳的，代碼足以辨識。
 */
function describeError(error: Record<string, unknown> | null): string {
  if (!error) return '';
  const issues = error.issues;
  if (Array.isArray(issues)) {
    return issues
      .filter(
        (issue): issue is { column: string | null; code: string } =>
          typeof issue === 'object' && issue !== null,
      )
      .map((issue) => (issue.column ? `${issue.column}: ${issue.code}` : issue.code))
      .join('; ');
  }
  return typeof error.code === 'string' ? error.code : '';
}
