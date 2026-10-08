import { ChangeKind } from '@b2b-system/realtime';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import type { AuthUser, PermissionKey } from '@/common/types';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import type { JobQueue } from '@/core/jobs';
import { runInTenantContext } from '@/core/tenant';
import type { TenantContext } from '@/core/tenant';
import type { DataTransferApplyRow, DataTransferRow } from '@/db/schema';

import type { DataTransferRegistry } from '../data-transfer-registry.service';
import { DATA_TRANSFER_MAX_ACTIVE_PER_USER } from '../data-transfer.constants';
import type { ClientPreference, DataTransferContextFactory } from '../data-transfer.context';
import { DATA_TRANSFER_APPLY_IMPORT_JOB } from '../data-transfer.job-types';
import type { DataTransferLifecycle } from '../data-transfer.lifecycle';
import type { DataTransferRepository } from '../data-transfer.repository';
import type {
  AnyTransferResource,
  TransferColumn,
  TransferContext,
  TransferLocale,
} from '../data-transfer.types';
import type { CreateImportDto } from '../dto/data-transfer.dto';
import { DataTransferImportService, importFormatOf } from '../import/data-transfer-import.service';
import type { ImportValidator, ValidatedRow } from '../import/import-validator';
import type { ParsePool } from '../import/parse-pool';
import { readCsv, readXlsx } from '../import/sheet-reader';
import type { ReadSheetResult, SheetRow } from '../import/sheet-reader';

const ACTOR: AuthUser = { id: 'user-1', email: 'owner@example.com', status: 'active' };
const PREFERENCE: ClientPreference = { locale: null, timezone: null };
const MIB = 1024 * 1024;

/** 租戶的 feature 參數：列數上限 100、檔案上限 1 MB（目錄允許的最小值）。 */
const TENANT = {
  id: 'tenant-1',
  code: 'default',
  features: ['dataTransfer'],
  featureParams: { 'dataTransfer.importMaxRows': 100, 'dataTransfer.importMaxSizeMb': 1 },
} as unknown as TenantContext;

function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runInTenantContext(TENANT, fn);
}

interface UserRecord {
  id: string;
  email: string;
  roles: string[];
  status: string;
}

type Column = TransferColumn<UserRecord>;

const STATUS_OPTIONS = [
  { value: 'active', label: { 'zh-TW': '啟用', 'en-US': 'Active' } },
  { value: 'disabled', label: { 'zh-TW': '停用', 'en-US': 'Disabled' } },
];

function columnsFixture(): Column[] {
  return [
    {
      key: 'id',
      label: { 'zh-TW': '編號', 'en-US': 'ID' },
      kind: 'string',
      export: { get: (record) => record.id },
      import: { modes: ['update'], matchKey: 1, schema: z.string() },
    },
    {
      key: 'email',
      label: { 'zh-TW': '電子郵件', 'en-US': 'Email' },
      kind: 'string',
      example: '=a@example.com',
      hint: { 'zh-TW': '登入用', 'en-US': 'Used to sign in' },
      export: { get: (record) => record.email },
      import: {
        modes: ['create', 'update'],
        requiredOnCreate: true,
        matchKey: 2,
        schema: z.string(),
        suggest: vi.fn(async () => ['a@example.com', 'a@example.com', 'b@example.com']),
      },
    },
    {
      key: 'roles',
      label: { 'zh-TW': '角色', 'en-US': 'Roles' },
      kind: 'reference',
      multiple: {},
      example: '稽核人員;一般成員',
      reference: {
        resolve: vi.fn(async () => new Map()),
        search: vi.fn(async () =>
          Array.from({ length: 25 }, (_, index) => ({
            id: `role-${index}`,
            label: `角色${index}`,
          })),
        ),
      },
      export: { get: (record) => record.roles },
      import: { modes: ['create', 'update'], schema: z.string(), permission: 'user:assignRole' },
    },
    {
      key: 'status',
      label: { 'zh-TW': '狀態', 'en-US': 'Status' },
      kind: 'enum',
      enum: STATUS_OPTIONS,
      export: { get: (record) => record.status },
      import: { modes: ['update'], schema: z.string() },
    },
    {
      key: 'level',
      label: { 'zh-TW': '等級', 'en-US': 'Level' },
      kind: 'enum',
      // 超過說明頁列出的上限（12）：不列選項
      enum: Array.from({ length: 13 }, (_, index) => ({
        value: `l${index}`,
        label: { 'zh-TW': `等級${index}`, 'en-US': `Level ${index}` },
      })),
      import: { modes: ['create'], schema: z.string() },
    },
    {
      key: 'secret',
      label: { 'zh-TW': '機密', 'en-US': 'Secret' },
      kind: 'string',
      permission: 'user:resetMfa',
      export: { get: () => 'x' },
    },
    {
      key: 'createdAt',
      label: { 'zh-TW': '建立時間', 'en-US': 'Created at' },
      kind: 'datetime',
      export: { get: () => null },
    },
  ];
}

/** 所有欄位都沒有範例值。 */
function columnsWithoutExamples(): Column[] {
  return columnsFixture().map((column) => Object.assign(column, { example: undefined }));
}

function resourceFixture(
  overrides: Partial<AnyTransferResource> = {},
  importer: Partial<NonNullable<AnyTransferResource['importer']>> = {},
): AnyTransferResource {
  return {
    type: 'user',
    fileBaseName: 'users',
    label: { 'zh-TW': '使用者', 'en-US': 'Users' },
    columns: columnsFixture(),
    importer: {
      modes: { create: { permissions: ['user:create'] }, update: { permissions: ['user:update'] } },
      uniqueColumns: ['email'],
      sampleRecords: vi.fn(async () => [
        { id: 'u1', email: '=cmd', roles: ['稽核人員', '一般成員'], status: 'active' },
      ]),
      searchTargets: vi.fn(async () =>
        Array.from({ length: 21 }, (_, index) => ({ id: `t${index}`, label: `目標${index}` })),
      ),
      findTargetsById: vi.fn(async () => new Map()),
      ...importer,
    },
    ...overrides,
  };
}

function ctxFixture(granted: readonly string[], locale: TransferLocale = 'zh-TW'): TransferContext {
  const set = new Set(granted);
  return {
    actor: ACTOR,
    locale,
    timezone: 'Asia/Taipei',
    signal: new AbortController().signal,
    can: (key: PermissionKey) => set.has(key),
  };
}

const ALL = ['user:create', 'user:update', 'user:assignRole', 'user:resetMfa'];

function transferRow(overrides: Partial<DataTransferRow> = {}): DataTransferRow {
  return {
    id: 'transfer-1',
    direction: 'import',
    type: 'user',
    mode: 'create',
    format: 'csv',
    status: 'completed',
    createdBy: ACTOR.id,
    locale: 'zh-TW',
    timezone: 'Asia/Taipei',
    params: { skipInvalid: false, columns: ['email', 'roles'] },
    sourceName: 'users.xlsx',
    outputKey: null,
    outputName: null,
    outputSize: null,
    totalRows: 1,
    processedRows: 0,
    succeededRows: 0,
    failedRows: 0,
    skippedRows: 0,
    errorCode: null,
    errorDetails: null,
    version: 1,
    expiresAt: new Date('2026-10-09T00:00:00.000Z'),
    startedAt: null,
    finishedAt: null,
    createdAt: new Date('2026-10-08T00:00:00.000Z'),
    updatedAt: new Date('2026-10-08T00:00:00.000Z'),
    ...overrides,
  };
}

function applyRow(overrides: Partial<DataTransferApplyRow> = {}): DataTransferApplyRow {
  return {
    transferId: 'transfer-1',
    rowNo: 1,
    sourceRow: 2,
    raw: { email: 'a@example.com', roles: '稽核人員' },
    targetId: null,
    targetVersion: null,
    targetManual: false,
    targetExpected: null,
    outcome: 'succeeded',
    outcomeError: null,
    changes: null,
    resultId: null,
    updatedAt: new Date('2026-10-08T00:00:00.000Z'),
    ...overrides,
  };
}

function parsed(header: string[], rows: SheetRow[], extra: Partial<ReadSheetResult> = {}) {
  return { ok: true, header, rows, warnings: [], ...extra } as ReadSheetResult;
}

function setup(
  options: {
    resource?: AnyTransferResource;
    granted?: readonly string[];
    locale?: TransferLocale;
  } = {},
) {
  const resource = options.resource ?? resourceFixture();
  const ctx = ctxFixture(options.granted ?? ALL, options.locale);
  const tx = { name: 'tx' };
  const db = { transaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)) };
  const repo = {
    countActive: vi.fn(async () => 0),
    create: vi.fn(async (values: Partial<DataTransferRow>) =>
      transferRow({ ...values, status: 'queued' }),
    ),
    insertRows: vi.fn(async () => undefined),
    findById: vi.fn(async (): Promise<DataTransferRow | undefined> => transferRow()),
    listRows: vi.fn(async (): Promise<DataTransferApplyRow[]> => [applyRow()]),
  };
  const registry = { require: vi.fn(() => resource) };
  const contexts = {
    assertHasAll: vi.fn(async () => undefined),
    forRequest: vi.fn(async () => ctx),
  };
  const lifecycle = {
    pendingExpiresAt: vi.fn(() => new Date('2026-10-09T00:00:00.000Z')),
    publish: vi.fn(),
  };
  const validator = {
    validate: vi.fn(
      async (_resource: unknown, _mode: unknown, rows: readonly { rowNo: number }[]) =>
        rows.map((row): ValidatedRow => ({ rowNo: row.rowNo, issues: [], values: {}, texts: {} })),
    ),
    toResponse: vi.fn((row: ValidatedRow) => ({ rowNo: row.rowNo, issues: row.issues })),
  };
  const pool = { parse: vi.fn(async (): Promise<ReadSheetResult> => parsed(['email'], [])) };
  const jobs = { enqueue: vi.fn(async () => undefined) };
  const service = new DataTransferImportService(
    db as unknown as Database,
    repo as unknown as DataTransferRepository,
    registry as unknown as DataTransferRegistry,
    contexts as unknown as DataTransferContextFactory,
    lifecycle as unknown as DataTransferLifecycle,
    validator as unknown as ImportValidator,
    pool as unknown as ParsePool,
    jobs as unknown as JobQueue,
  );
  return {
    service,
    resource,
    ctx,
    tx,
    db,
    repo,
    registry,
    contexts,
    lifecycle,
    validator,
    pool,
    jobs,
  };
}

function createImportDto(overrides: Partial<CreateImportDto> = {}): CreateImportDto {
  return {
    type: 'user',
    mode: 'update',
    fileName: 'users.xlsx',
    skipInvalid: true,
    rows: [
      {
        rowNo: 1,
        sourceRow: 2,
        cells: { status: 'disabled', email: 'a@example.com' },
        target: { id: 'target-1', version: 3, expected: { roleIds: [] } },
      },
      { rowNo: 2, cells: { email: 'b@example.com' }, targetId: 'manual-1' },
      { rowNo: 3, cells: { email: 'c@example.com' }, targetId: null },
      { rowNo: 4, sourceRow: null, cells: { email: 'd@example.com' } },
    ],
    ...overrides,
  };
}

function upload(originalname: string, size = 10) {
  return { originalname, size, buffer: Buffer.from('x') };
}

describe('importFormatOf（docs/architecture/backend/22-data-transfer.md §7.3）', () => {
  it.each([
    ['users.XLSX', 'xlsx'],
    ['users.csv', 'csv'],
    ['users.tsv', 'csv'],
    ['users.txt', 'csv'],
    ['users.json', 'json'],
    ['users.yaml', 'yaml'],
    ['users.yml', 'yaml'],
    ['users.xls', null],
    ['users', null],
  ])('%s → %s', (fileName, expected) => {
    expect(importFormatOf(fileName)).toBe(expected);
  });
});

describe('DataTransferImportService（docs/architecture/backend/22-data-transfer.md §7）', () => {
  describe('columns：可匯入的欄位', () => {
    it('檢查這個模式的權限後回傳可匯入欄位與看得到的唯讀欄位', async () => {
      const { service, contexts, registry } = setup({
        granted: ['user:create', 'user:assignRole'],
      });
      const result = await service.columns('user', 'create', ACTOR, PREFERENCE);
      expect(registry.require).toHaveBeenCalledWith('user', 'import', 'create');
      expect(contexts.assertHasAll).toHaveBeenCalledWith(
        ACTOR,
        ['user:create'],
        'GET /data-transfers/importers/:type',
      );
      expect(result.items.map((item) => item.key)).toEqual(['email', 'roles', 'level']);
      expect(result.items[0]).toMatchObject({ key: 'email', label: '電子郵件', required: true });
      // 機密欄位讀不到：不出現在唯讀欄位
      expect(result.readOnly).toEqual([
        { key: 'id', label: '編號' },
        { key: 'status', label: '狀態' },
        { key: 'createdAt', label: '建立時間' },
      ]);
    });

    it('權限不足時傳出 assertHasAll 的錯誤', async () => {
      const { service, contexts } = setup();
      contexts.assertHasAll.mockRejectedValue(new AppException('AUTHZ_FORBIDDEN'));
      await expect(service.columns('user', 'update', ACTOR, PREFERENCE)).rejects.toMatchObject({
        code: 'AUTHZ_FORBIDDEN',
      });
    });

    it('資源沒有這個模式的權限設定時不要求額外權限', async () => {
      const { service, contexts } = setup({ resource: resourceFixture({ importer: undefined }) });
      await service.columns('user', 'create', ACTOR, PREFERENCE);
      expect(contexts.assertHasAll).toHaveBeenCalledWith(ACTOR, [], expect.any(String));
    });
  });

  describe('template：範本（§7.2）', () => {
    it('JSON：修改模式以抽樣的現有資料填入，值保留型別、多值是陣列', async () => {
      const { service, resource } = setup();
      const file = await service.template(
        'user',
        { mode: 'update', format: 'json' },
        ACTOR,
        PREFERENCE,
      );
      expect(resource.importer?.sampleRecords).toHaveBeenCalledWith(expect.anything(), 10);
      expect(file.fileName).toBe('users-template-update.json');
      expect(file.contentType).toContain('application/json');
      expect(JSON.parse(file.body.toString('utf8'))).toEqual([
        { id: 'u1', email: '=cmd', roles: ['稽核人員', '一般成員'], status: 'active' },
      ]);
    });

    it('YAML：新增模式以範例值組一筆，多值依 ; 拆成陣列、沒有範例的是 null', async () => {
      const { service, resource } = setup();
      const file = await service.template(
        'user',
        { mode: 'create', format: 'yaml' },
        ACTOR,
        PREFERENCE,
      );
      expect(resource.importer?.sampleRecords).not.toHaveBeenCalled();
      expect(file.fileName).toBe('users-template-create.yaml');
      expect(parseYaml(file.body.toString('utf8'))).toEqual([
        { email: '=a@example.com', roles: ['稽核人員', '一般成員'], level: null },
      ]);
    });

    it('JSON：修改模式但資源沒有抽樣、欄位也沒有範例時是空陣列', async () => {
      const resource = resourceFixture(
        { columns: columnsWithoutExamples() },
        { sampleRecords: undefined },
      );
      const { service } = setup({ resource });
      const file = await service.template(
        'user',
        { mode: 'update', format: 'json' },
        ACTOR,
        PREFERENCE,
      );
      expect(JSON.parse(file.body.toString('utf8'))).toEqual([]);
    });

    it('CSV：修改模式的抽樣資料轉成儲存格文字，開頭是公式字元的文字前置單引號', async () => {
      const { service } = setup();
      const file = await service.template(
        'user',
        { mode: 'update', format: 'csv' },
        ACTOR,
        PREFERENCE,
      );
      expect(file.contentType).toContain('text/csv');
      expect(readCsv(new Uint8Array(file.body), 'auto')).toMatchObject({
        ok: true,
        header: ['編號', '電子郵件', '角色', '狀態'],
        rows: [{ cells: ['u1', "'=cmd", '稽核人員;一般成員', '啟用'] }],
      });
    });

    it('CSV：新增模式以範例值組一列；沒有範例時只有標頭', async () => {
      const { service } = setup({ locale: 'en-US' });
      const file = await service.template(
        'user',
        { mode: 'create', format: 'csv' },
        ACTOR,
        PREFERENCE,
      );
      expect(readCsv(new Uint8Array(file.body), 'auto')).toMatchObject({
        header: ['Email', 'Roles', 'Level'],
        rows: [{ cells: ["'=a@example.com", '稽核人員;一般成員', ''] }],
      });

      const bare = resourceFixture({
        columns: columnsWithoutExamples(),
      });
      const empty = await setup({ resource: bare }).service.template(
        'user',
        { mode: 'create', format: 'csv' },
        ACTOR,
        PREFERENCE,
      );
      expect(readCsv(new Uint8Array(empty.body), 'auto')).toMatchObject({
        header: ['電子郵件', '角色', '等級'],
        rows: [],
      });
    });

    it('XLSX：附欄位說明的工作表（必填、格式、選項、提示與多值說明）', async () => {
      const { service } = setup();
      const file = await service.template(
        'user',
        { mode: 'create', format: 'xlsx' },
        ACTOR,
        PREFERENCE,
      );
      expect(file.fileName).toBe('users-template-create.xlsx');
      expect(file.contentType).toContain('spreadsheetml');
      const bytes = new Uint8Array(file.body);
      expect(await readXlsx(bytes)).toMatchObject({
        ok: true,
        header: ['電子郵件', '角色', '等級'],
        rows: [{ cells: ['=a@example.com', '稽核人員;一般成員', ''] }],
        sheets: ['使用者', '欄位說明'],
      });
      expect(await readXlsx(bytes, '欄位說明')).toMatchObject({
        header: ['欄位', '必填', '格式', '可用的選項', '說明'],
        rows: [
          { cells: ['電子郵件', '是', '文字', '', '登入用'] },
          { cells: ['角色', '', '名稱', '', '多個值以 ; 分隔'] },
          { cells: ['等級', '', '選項', '', ''] },
        ],
      });
    });

    it('XLSX：修改模式不標必填，選項不多時列出', async () => {
      const { service } = setup({ locale: 'en-US' });
      const file = await service.template(
        'user',
        { mode: 'update', format: 'xlsx' },
        ACTOR,
        PREFERENCE,
      );
      expect(await readXlsx(new Uint8Array(file.body), 'Columns')).toMatchObject({
        header: ['Column', 'Required', 'Format', 'Options', 'Notes'],
        rows: [
          { cells: ['ID', '', 'Text', '', ''] },
          { cells: ['Email', '', 'Text', '', 'Used to sign in'] },
          { cells: ['Roles', '', 'Name', '', 'Separate values with ;'] },
          { cells: ['Status', '', 'Option', 'Active、Disabled', ''] },
        ],
      });
    });
  });

  describe('options：預覽中的選項', () => {
    it('reference 欄：搜尋參照，最多 20 筆', async () => {
      const { service } = setup();
      const result = await service.options('user', 'roles', '角', ACTOR, PREFERENCE);
      expect(result.items).toHaveLength(20);
      expect(result.items[0]).toEqual({ id: 'role-0', label: '角色0' });
    });

    it('文字欄的自動完成：去重複，id 與 label 都是值', async () => {
      const { service, ctx, resource } = setup({ granted: ['user:update'] });
      const result = await service.options('user', 'email', 'a', ACTOR, PREFERENCE);
      const email = resource.columns.find((column) => column.key === 'email');
      expect(email?.import?.suggest).toHaveBeenCalledWith('a', ctx);
      expect(result.items).toEqual([
        { id: 'a@example.com', label: 'a@example.com' },
        { id: 'b@example.com', label: 'b@example.com' },
      ]);
    });

    it.each([
      ['欄位不存在', 'nope', ALL],
      ['欄位沒有參照也沒有自動完成', 'status', ALL],
      ['任何模式都沒有權限', 'email', []],
    ])('VALIDATION_FAILED：%s', async (_name, key, granted) => {
      const { service } = setup({ granted });
      await expect(service.options('user', key, '', ACTOR, PREFERENCE)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { fields: { column: key } },
      });
    });

    it('沒有匯入這一欄的權限時回 AUTHZ_FORBIDDEN，列出缺少的權限', async () => {
      const { service } = setup({ granted: ['user:create'] });
      await expect(service.options('user', 'roles', '', ACTOR, PREFERENCE)).rejects.toMatchObject({
        code: 'AUTHZ_FORBIDDEN',
        details: { missing: ['user:assignRole'] },
      });
    });

    it('讀不到欄位時缺少的是讀取權限', async () => {
      const columns = columnsFixture().map((column) =>
        column.key === 'email'
          ? Object.assign(column, { permission: 'user:resetMfa' as const })
          : column,
      );
      const { service } = setup({
        resource: resourceFixture({ columns }),
        granted: ['user:create'],
      });
      await expect(service.options('user', 'email', '', ACTOR, PREFERENCE)).rejects.toMatchObject({
        code: 'AUTHZ_FORBIDDEN',
        details: { missing: ['user:resetMfa'] },
      });
    });
  });

  describe('targets：手動指定比對目標（§7.5）', () => {
    it('以修改模式的權限搜尋，最多 20 筆', async () => {
      const { service, contexts } = setup();
      const result = await service.targets('user', '目', ACTOR, PREFERENCE);
      expect(contexts.assertHasAll).toHaveBeenCalledWith(
        ACTOR,
        ['user:update'],
        'GET /data-transfers/importers/:type/targets',
      );
      expect(result.items).toHaveLength(20);
    });

    it.each([
      ['沒有 searchTargets', { searchTargets: undefined }],
      ['沒有 findTargetsById', { findTargetsById: undefined }],
    ])('資源不能手動指定時回 VALIDATION_FAILED（%s）', async (_name, importer) => {
      const { service } = setup({ resource: resourceFixture({}, importer) });
      await expect(service.targets('user', '', ACTOR, PREFERENCE)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { fields: { type: 'user' } },
      });
    });
  });

  describe('analyze：分析（§7.3）', () => {
    const DTO = { mode: 'create' as const, encoding: 'auto' as const };

    it('檔案超過大小上限回 DATA_TRANSFER_FILE_TOO_LARGE，不解析', async () => {
      const { service, pool } = setup();
      await expect(
        inTenant(() => service.analyze('user', DTO, upload('a.csv', MIB + 1), ACTOR, PREFERENCE)),
      ).rejects.toMatchObject({ code: 'DATA_TRANSFER_FILE_TOO_LARGE', details: { maxBytes: MIB } });
      expect(pool.parse).not.toHaveBeenCalled();
    });

    it('不認得的副檔名回 DATA_TRANSFER_FILE_UNREADABLE（format）', async () => {
      const { service } = setup();
      await expect(
        inTenant(() => service.analyze('user', DTO, upload('a.xls'), ACTOR, PREFERENCE)),
      ).rejects.toMatchObject({
        code: 'DATA_TRANSFER_FILE_UNREADABLE',
        details: { reason: 'format' },
      });
    });

    it('讀檔器讀不了時回 DATA_TRANSFER_FILE_UNREADABLE 並帶原因；指定的工作表傳給讀檔器', async () => {
      const { service, pool } = setup();
      pool.parse.mockResolvedValue({ ok: false, reason: 'sheetNotFound' });
      await expect(
        inTenant(() =>
          service.analyze('user', { ...DTO, sheet: 'Data' }, upload('a.xlsx'), ACTOR, PREFERENCE),
        ),
      ).rejects.toMatchObject({
        code: 'DATA_TRANSFER_FILE_UNREADABLE',
        details: { reason: 'sheetNotFound' },
      });
      expect(pool.parse).toHaveBeenCalledWith(expect.any(Uint8Array), {
        format: 'xlsx',
        encoding: 'auto',
        sheet: 'Data',
      });
    });

    it('超過列數上限回 DATA_TRANSFER_TOO_MANY_ROWS，不截斷', async () => {
      const { service, pool } = setup();
      const rows = Array.from({ length: 101 }, (_, index) => ({
        sourceRow: index + 2,
        cells: ['a@example.com'],
      }));
      pool.parse.mockResolvedValue(parsed(['email'], rows));
      await expect(
        inTenant(() => service.analyze('user', DTO, upload('a.csv'), ACTOR, PREFERENCE)),
      ).rejects.toMatchObject({
        code: 'DATA_TRANSFER_TOO_MANY_ROWS',
        details: { max: 100, count: 101 },
      });
    });

    it('有不認得的標頭時回 needsMapping：建議、前 5 列樣本、被忽略的標頭與工作表清單', async () => {
      const { service, pool, validator } = setup({ granted: ['user:create'] });
      const rows = Array.from({ length: 6 }, (_, index) => ({
        sourceRow: index + 2,
        cells: [`u${index}@example.com`, 'x', 'y', 'z'],
      }));
      pool.parse.mockResolvedValue(
        parsed(['Email', '角色', '建立時間', '不認得'], rows, { sheets: ['Data', 'Other'] }),
      );
      const result = await inTenant(() =>
        service.analyze('user', DTO, upload('users.xlsx'), ACTOR, PREFERENCE),
      );
      expect(validator.validate).not.toHaveBeenCalled();
      expect(result).toEqual({
        status: 'needsMapping',
        fileName: 'users.xlsx',
        headers: [
          { index: 0, text: 'Email', suggestion: 'email' },
          { index: 1, text: '角色', suggestion: null },
          { index: 2, text: '建立時間', suggestion: null },
          { index: 3, text: '不認得', suggestion: null },
        ],
        samples: rows.slice(0, 5).map((row) => row.cells),
        ignored: [
          { index: 1, header: '角色', reason: 'forbidden' },
          { index: 2, header: '建立時間', reason: 'readOnly' },
        ],
        columns: [
          expect.objectContaining({ key: 'email' }),
          expect.objectContaining({ key: 'level' }),
        ],
        sheets: ['Data', 'Other'],
      });
    });

    it('對應完成時逐列驗證；結果報告的欄自動忽略，公式沒有結果的儲存格加警告', async () => {
      const { service, pool, validator, resource } = setup();
      pool.parse.mockResolvedValue(
        parsed(
          ['電子郵件', '角色', '列號'],
          [
            { sourceRow: 2, cells: [' a@example.com ', '稽核人員', '2'] },
            { sourceRow: 4, cells: ['b@example.com', '', '4'] },
          ],
          {
            sheets: ['Data'],
            warnings: [
              { sourceRow: 2, column: 1, code: 'formulaWithoutValue' },
              // 對到被忽略的欄、或不在資料列的警告不加
              { sourceRow: 4, column: 2, code: 'formulaWithoutValue' },
              { sourceRow: 9, column: 0, code: 'formulaWithoutValue' },
            ],
          },
        ),
      );
      const result = await inTenant(() =>
        service.analyze('user', DTO, upload('users.csv', 100), ACTOR, PREFERENCE),
      );
      const rows = [
        { rowNo: 1, sourceRow: 2, cells: { email: 'a@example.com', roles: '稽核人員' } },
        { rowNo: 2, sourceRow: 4, cells: { email: 'b@example.com', roles: '' } },
      ];
      expect(validator.validate).toHaveBeenCalledWith(resource, 'create', rows, expect.anything());
      expect(result).toEqual({
        status: 'ok',
        fileName: 'users.csv',
        columns: [
          expect.objectContaining({ key: 'email' }),
          expect.objectContaining({ key: 'roles' }),
        ],
        ignored: [{ header: '列號', reason: 'readOnly' }],
        rows,
        results: [
          {
            rowNo: 1,
            issues: [{ column: 'roles', code: 'formulaWithoutValue', severity: 'warning' }],
          },
          { rowNo: 2, issues: [] },
        ],
      });
    });

    it('以請求帶的對應為準', async () => {
      const { service, pool } = setup();
      pool.parse.mockResolvedValue(
        parsed(['A', 'B'], [{ sourceRow: 2, cells: ['a@example.com', 'ignored'] }], {
          sheets: ['Data', 'Other'],
        }),
      );
      const result = await inTenant(() =>
        service.analyze(
          'user',
          { ...DTO, mapping: JSON.stringify({ 0: 'email', 1: null }) },
          upload('users.json'),
          ACTOR,
          PREFERENCE,
        ),
      );
      expect(result).toMatchObject({
        status: 'ok',
        ignored: [{ header: 'B', reason: 'unmapped' }],
        rows: [{ cells: { email: 'a@example.com' } }],
        sheets: ['Data', 'Other'],
      });
    });

    it('對應的 JSON 不合法時回 DATA_TRANSFER_MAPPING_INVALID', async () => {
      const { service, pool } = setup();
      pool.parse.mockResolvedValue(parsed(['A'], []));
      await expect(
        inTenant(() =>
          service.analyze('user', { ...DTO, mapping: '{' }, upload('a.yml'), ACTOR, PREFERENCE),
        ),
      ).rejects.toMatchObject({ code: 'DATA_TRANSFER_MAPPING_INVALID' });
    });
  });

  describe('validate：驗證改過的列（§7.4）', () => {
    const ROWS = [{ rowNo: 1, cells: { email: 'a@example.com' } }];

    it('帶同檔引用的值時傳給驗證器', async () => {
      const { service, validator, resource } = setup();
      const result = await service.validate(
        'user',
        { mode: 'create', rows: ROWS, fileKeys: { code: ['A'] } },
        ACTOR,
        PREFERENCE,
      );
      expect(validator.validate).toHaveBeenCalledWith(resource, 'create', ROWS, expect.anything(), {
        fileKeys: { code: ['A'] },
      });
      expect(result).toEqual({ rows: [{ rowNo: 1, issues: [] }] });
    });

    it('沒有同檔引用時不帶選項', async () => {
      const { service, validator } = setup();
      await service.validate('user', { mode: 'update', rows: ROWS }, ACTOR, PREFERENCE);
      expect(validator.validate).toHaveBeenCalledWith(
        expect.anything(),
        'update',
        ROWS,
        expect.anything(),
        {},
      );
    });
  });

  describe('createImport：送出套用（§7.6）', () => {
    it('在交易內建立傳輸、寫入套用列、入列套用工作，交易後推播', async () => {
      const { service, repo, jobs, lifecycle, tx } = setup();
      const result = await inTenant(() =>
        service.createImport(createImportDto(), ACTOR, PREFERENCE, 100),
      );
      expect(repo.countActive).toHaveBeenCalledWith(ACTOR.id, tx);
      expect(repo.create).toHaveBeenCalledWith(
        {
          direction: 'import',
          type: 'user',
          mode: 'update',
          format: 'xlsx',
          status: 'queued',
          createdBy: ACTOR.id,
          locale: 'zh-TW',
          timezone: 'Asia/Taipei',
          // 依資源定義的順序
          params: { skipInvalid: true, columns: ['email', 'status'] },
          sourceName: 'users.xlsx',
          totalRows: 4,
          expiresAt: new Date('2026-10-09T00:00:00.000Z'),
        },
        tx,
      );
      expect(repo.insertRows).toHaveBeenCalledWith(
        [
          {
            transferId: 'transfer-1',
            rowNo: 1,
            sourceRow: 2,
            raw: { status: 'disabled', email: 'a@example.com' },
            targetManual: false,
            targetId: 'target-1',
            targetVersion: 3,
            targetExpected: { roleIds: [] },
          },
          {
            transferId: 'transfer-1',
            rowNo: 2,
            sourceRow: null,
            raw: { email: 'b@example.com' },
            targetManual: true,
            targetId: 'manual-1',
            targetVersion: null,
            targetExpected: null,
          },
          {
            transferId: 'transfer-1',
            rowNo: 3,
            sourceRow: null,
            raw: { email: 'c@example.com' },
            targetManual: true,
            targetId: null,
            targetVersion: null,
            targetExpected: null,
          },
          {
            transferId: 'transfer-1',
            rowNo: 4,
            sourceRow: null,
            raw: { email: 'd@example.com' },
            targetManual: false,
            targetId: null,
            targetVersion: null,
            targetExpected: null,
          },
        ],
        tx,
      );
      expect(jobs.enqueue).toHaveBeenCalledWith(
        DATA_TRANSFER_APPLY_IMPORT_JOB,
        { transferId: 'transfer-1' },
        { tx },
      );
      expect(lifecycle.publish).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'transfer-1' }),
        ChangeKind.CREATE,
      );
      expect(result).toMatchObject({ id: 'transfer-1', status: 'queued', direction: 'import' });
    });

    it.each([
      ['沒有檔名', undefined, 'csv', null],
      ['副檔名不認得', 'users.xls', 'csv', 'users.xls'],
      ['JSON', 'users.json', 'json', 'users.json'],
    ])('格式依檔名判斷，判斷不了是 csv（%s）', async (_name, fileName, format, sourceName) => {
      const { service, repo } = setup();
      await inTenant(() =>
        service.createImport(
          createImportDto({
            mode: 'create',
            fileName,
            rows: [{ rowNo: 1, cells: { email: 'a' } }],
          }),
          ACTOR,
          PREFERENCE,
          100,
        ),
      );
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ format, sourceName }),
        expect.anything(),
      );
    });

    it('請求本體超過檔案上限的兩倍回 DATA_TRANSFER_FILE_TOO_LARGE', async () => {
      const { service, db } = setup();
      await expect(
        inTenant(() => service.createImport(createImportDto(), ACTOR, PREFERENCE, 2 * MIB + 1)),
      ).rejects.toMatchObject({
        code: 'DATA_TRANSFER_FILE_TOO_LARGE',
        details: { maxBytes: 2 * MIB },
      });
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('超過列數上限回 DATA_TRANSFER_TOO_MANY_ROWS', async () => {
      const { service } = setup();
      const rows = Array.from({ length: 101 }, (_, index) => ({
        rowNo: index + 1,
        cells: { email: 'a' },
      }));
      await expect(
        inTenant(() => service.createImport(createImportDto({ rows }), ACTOR, PREFERENCE, 100)),
      ).rejects.toMatchObject({
        code: 'DATA_TRANSFER_TOO_MANY_ROWS',
        details: { max: 100, count: 101 },
      });
    });

    it('列號重複回 VALIDATION_FAILED', async () => {
      const { service } = setup();
      const rows = [
        { rowNo: 1, cells: { email: 'a' } },
        { rowNo: 1, cells: { email: 'b' } },
      ];
      await expect(
        inTenant(() => service.createImport(createImportDto({ rows }), ACTOR, PREFERENCE, 100)),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { fields: { rows: 'duplicate rowNo' } },
      });
    });

    it('有不能匯入（或沒有權限）的欄位回 DATA_TRANSFER_MAPPING_INVALID', async () => {
      const { service, db } = setup({ granted: ['user:update'] });
      const rows = [{ rowNo: 1, cells: { email: 'a', roles: '稽核人員' } }];
      await expect(
        inTenant(() => service.createImport(createImportDto({ rows }), ACTOR, PREFERENCE, 100)),
      ).rejects.toMatchObject({
        code: 'DATA_TRANSFER_MAPPING_INVALID',
        details: { column: 'roles' },
      });
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('進行中的傳輸已達上限回 DATA_TRANSFER_LIMIT_EXCEEDED，不建立也不推播', async () => {
      const { service, repo, lifecycle, jobs } = setup();
      repo.countActive.mockResolvedValue(DATA_TRANSFER_MAX_ACTIVE_PER_USER);
      await expect(
        inTenant(() => service.createImport(createImportDto(), ACTOR, PREFERENCE, 100)),
      ).rejects.toMatchObject({
        code: 'DATA_TRANSFER_LIMIT_EXCEEDED',
        details: { max: DATA_TRANSFER_MAX_ACTIVE_PER_USER },
      });
      expect(repo.create).not.toHaveBeenCalled();
      expect(jobs.enqueue).not.toHaveBeenCalled();
      expect(lifecycle.publish).not.toHaveBeenCalled();
    });
  });

  describe('report：結果報告（§7.7）', () => {
    it.each([
      ['不存在', undefined],
      ['別人的', transferRow({ createdBy: 'someone-else' })],
    ])('%s的傳輸回 DATA_TRANSFER_NOT_FOUND', async (_name, transfer) => {
      const { service, repo } = setup();
      repo.findById.mockResolvedValue(transfer);
      await expect(
        service.report('transfer-1', { format: 'csv', rows: 'all' }, ACTOR),
      ).rejects.toMatchObject({ code: 'DATA_TRANSFER_NOT_FOUND' });
    });

    it('匯出的傳輸回 DATA_TRANSFER_INVALID_STATE', async () => {
      const { service, repo } = setup();
      repo.findById.mockResolvedValue(transferRow({ direction: 'export', status: 'completed' }));
      await expect(
        service.report('transfer-1', { format: 'csv', rows: 'all' }, ACTOR),
      ).rejects.toMatchObject({
        code: 'DATA_TRANSFER_INVALID_STATE',
        details: { status: 'completed' },
      });
    });

    it('已過期回 DATA_TRANSFER_EXPIRED', async () => {
      const { service, repo } = setup();
      repo.findById.mockResolvedValue(transferRow({ status: 'expired' }));
      await expect(
        service.report('transfer-1', { format: 'csv', rows: 'all' }, ACTOR),
      ).rejects.toMatchObject({ code: 'DATA_TRANSFER_EXPIRED' });
    });

    it('CSV：原本的欄位加上列號、結果、錯誤；已移除的欄位略過；文字欄防公式注入', async () => {
      const { service, repo } = setup();
      repo.findById.mockResolvedValue(
        transferRow({ params: { columns: ['email', 'removed', 'roles'] } }),
      );
      repo.listRows.mockResolvedValue([
        applyRow({ rowNo: 1, sourceRow: 2, raw: { email: '=evil', roles: '稽核人員' } }),
        applyRow({
          rowNo: 2,
          sourceRow: null,
          raw: { email: 'b@example.com' },
          outcome: 'failed',
          outcomeError: {
            code: 'VALIDATION_FAILED',
            issues: [
              { column: 'email', code: 'alreadyExists' },
              { column: null, code: 'rowConflict' },
              null,
            ],
          },
        }),
        applyRow({
          rowNo: 3,
          outcome: 'failed',
          outcomeError: { code: 'USER_EMAIL_TAKEN', details: {} },
        }),
        applyRow({ rowNo: 4, outcome: 'mystery', outcomeError: { details: {} } }),
      ]);
      const file = await service.report('transfer-1', { format: 'csv', rows: 'all' }, ACTOR);
      expect(repo.listRows).toHaveBeenCalledWith('transfer-1', {
        outcome: undefined,
        afterRowNo: undefined,
        limit: 1000,
      });
      expect(file.fileName).toBe('users-result.csv');
      expect(file.contentType).toContain('text/csv');
      expect(readCsv(new Uint8Array(file.body), 'auto')).toMatchObject({
        ok: true,
        header: ['電子郵件', '角色', '列號', '結果', '錯誤'],
        rows: [
          { cells: ["'=evil", '稽核人員', '2', '成功', ''] },
          {
            cells: ['b@example.com', '', '2', '失敗', 'email: alreadyExists; rowConflict'],
          },
          { cells: ['a@example.com', '稽核人員', '2', '失敗', 'USER_EMAIL_TAKEN'] },
          { cells: ['a@example.com', '稽核人員', '2', 'mystery', ''] },
        ],
      });
    });

    it('XLSX、英文、只要失敗的列：逐頁讀到最後一頁；沒有原始檔名時以資源命名', async () => {
      const { service, repo } = setup();
      repo.findById.mockResolvedValue(
        transferRow({ locale: 'en-US', sourceName: null, params: { columns: ['email'] } }),
      );
      const fullPage = Array.from({ length: 1000 }, (_, index) =>
        applyRow({ rowNo: index + 1, outcome: 'failed' }),
      );
      repo.listRows
        .mockResolvedValueOnce(fullPage)
        .mockResolvedValueOnce([applyRow({ rowNo: 1001, sourceRow: null, outcome: 'cancelled' })]);
      const file = await service.report('transfer-1', { format: 'xlsx', rows: 'failed' }, ACTOR);
      expect(repo.listRows).toHaveBeenNthCalledWith(1, 'transfer-1', {
        outcome: ['failed'],
        afterRowNo: undefined,
        limit: 1000,
      });
      expect(repo.listRows).toHaveBeenNthCalledWith(2, 'transfer-1', {
        outcome: ['failed'],
        afterRowNo: 1000,
        limit: 1000,
      });
      expect(file.fileName).toBe('users-import-result.xlsx');
      expect(file.contentType).toContain('spreadsheetml');
      const result = await readXlsx(new Uint8Array(file.body));
      expect(result).toMatchObject({ ok: true, header: ['Email', 'Row', 'Result', 'Error'] });
      if (!result.ok) throw new Error('unreachable');
      expect(result.rows).toHaveLength(1001);
      // XLSX 不加防公式注入的前綴
      expect(result.rows[0]?.cells).toEqual(['a@example.com', '2', 'Failed', '']);
      expect(result.rows.at(-1)?.cells).toEqual(['a@example.com', '1001', 'Cancelled', '']);
    });
  });
});
