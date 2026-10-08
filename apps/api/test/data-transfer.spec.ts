import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { JobContext } from '@/core/jobs';
import { ObjectStorage } from '@/core/storage';
import {
  auditLogs,
  dataTransferRows,
  dataTransfers,
  notifications,
  relationTuples,
  roleHolderTuple,
  roles,
  users,
} from '@/db/schema';
import { DataTransferCleanupService } from '@/modules/data-transfer/data-transfer-cleanup.service';
import { registerDataTransferBodyParser } from '@/modules/data-transfer/data-transfer.http';
import { DataTransferExportService } from '@/modules/data-transfer/export/data-transfer-export.service';
import { DataTransferApplyService } from '@/modules/data-transfer/import/data-transfer-apply.service';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { InMemoryObjectStorage } from './in-memory-object-storage';
import { inTestTenant } from './tenant';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
const storage = new InMemoryObjectStorage();

const SUPER_ADMIN = { email: 'dt-root@example.com', password: 'Quiet-Harbor-Lantern-26' };
const ADMIN = { email: 'dt-admin@example.com', password: 'AdminPassword!2026' };
const AUDITOR = { email: 'dt-auditor@example.com', password: 'AuditorPassword!2026' };
const MEMBER = { email: 'dt-member@example.com', password: 'MemberPassword!2026' };

const tokens = new Map<string, string>();
async function login(credentials: { email: string; password: string }): Promise<string> {
  const cached = tokens.get(credentials.email);
  if (cached) return cached;
  const response = await request(http).post('/auth/login').send(credentials);
  if (response.status !== 200) throw new Error(JSON.stringify(response.body));
  const token = (response.body as { data: { accessToken: string } }).data.accessToken;
  tokens.set(credentials.email, token);
  return token;
}

async function createActiveUser(email: string, password: string, roleSlug: string | null) {
  const { hashPassword } = await import('@/modules/credential/password');
  const [user] = await db
    .insert(users)
    .values({
      email,
      displayName: email,
      passwordHash: await hashPassword(password),
      status: 'active',
    })
    .returning();
  if (roleSlug) {
    const [role] = await db.select().from(roles).where(eq(roles.slug, roleSlug));
    await db.insert(relationTuples).values(roleHolderTuple(role!.id, user!.id));
  }
  return user!;
}

interface TransferBody {
  id: string;
  status: string;
  version: number;
  totalRows: number;
  succeededRows: number;
  failedRows: number;
  skippedRows: number;
  outputName: string | null;
  errorCode: string | null;
}

const job = (): JobContext => ({
  id: 'test-job',
  retryCount: 0,
  signal: new AbortController().signal,
});

async function runExport(id: string) {
  return inTestTenant(app, () => app.get(DataTransferExportService).run(id, job()));
}

async function runApply(id: string) {
  return inTestTenant(app, () => app.get(DataTransferApplyService).run(id, job()));
}

async function getTransfer(token: string, id: string): Promise<TransferBody> {
  const response = await request(http)
    .get(`/data-transfers/${id}`)
    .set('authorization', `Bearer ${token}`)
    .expect(200);
  return (response.body as { data: TransferBody }).data;
}

async function createExport(token: string, body: object, status = 202) {
  return request(http)
    .post('/data-transfers/exports')
    .set('authorization', `Bearer ${token}`)
    .set('accept-language', 'zh-TW')
    .set('x-client-timezone', 'Asia/Taipei')
    .send(body)
    .expect(status);
}

/** 匯出檔的內容：記憶體版的物件儲存會保留伺服器端分段上傳的內容。 */
function outputOf(transferId: string): Buffer {
  const key = [...storage.contents.keys()].find((item) =>
    item.startsWith(`transfers/${transferId}/`),
  );
  if (!key) throw new Error(`找不到 ${transferId} 的匯出檔`);
  return storage.contents.get(key)!;
}

function analyze(token: string, file: Buffer, fileName: string, fields: Record<string, string>) {
  let call = request(http)
    .post('/data-transfers/importers/user/analyze')
    .set('authorization', `Bearer ${token}`)
    .set('accept-language', 'zh-TW')
    .attach('file', file, fileName);
  for (const [key, value] of Object.entries(fields)) call = call.field(key, value);
  return call;
}

interface AnalysisOk {
  status: 'ok';
  columns: { key: string }[];
  rows: { rowNo: number; sourceRow: number | null; cells: Record<string, string> }[];
  results: {
    rowNo: number;
    issues: {
      column: string | null;
      code: string;
      severity: string;
      params?: Record<string, unknown>;
    }[];
    target?: {
      id: string;
      version: number;
      current: Record<string, string>;
      expected?: Record<string, unknown>;
    };
    changed?: string[];
  }[];
  ignored: { header: string; reason: string }[];
}

const csv = (lines: string[]) => Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');

describe('匯入／匯出（docs/architecture/backend/22-data-transfer.md）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;
    process.env.DEFAULT_RATE_LIMIT = '10000';
    process.env.AUTH_RATE_LIMIT = '1000';
    process.env.DATA_TRANSFER_CLEANUP_CRON = '';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);
    await createActiveUser(ADMIN.email, ADMIN.password, 'admin');
    await createActiveUser(AUDITOR.email, AUDITOR.password, 'auditor');
    await createActiveUser(MEMBER.email, MEMBER.password, 'member');

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ObjectStorage)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    registerDataTransferBodyParser(app);
    await app.init();
    http = await listenOnLoopback(app);
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
    delete process.env.DEFAULT_RATE_LIMIT;
    delete process.env.AUTH_RATE_LIMIT;
    delete process.env.DATA_TRANSFER_CLEANUP_CRON;
  });

  beforeEach(async () => {
    await db.delete(dataTransfers);
  });

  describe('匯出', () => {
    it('沒有 user:export 時回 403；auditor 只能匯出稽核日誌與審批紀錄', async () => {
      const auditor = await login(AUDITOR);
      await createExport(auditor, { type: 'user', scope: { kind: 'filter', filter: {} } }, 403);
      await createExport(auditor, { type: 'auditLog', scope: { kind: 'filter', filter: {} } }, 202);
      const resources = await request(http)
        .get('/data-transfers/resources')
        .set('authorization', `Bearer ${auditor}`)
        .expect(200);
      const items = (
        resources.body as { data: { items: { type: string; importModes: string[] }[] } }
      ).data.items;
      expect(items.map((item) => item.type).toSorted()).toEqual([
        'approvalDecision',
        'approvalRequest',
        'auditLog',
      ]);
    });

    it('CSV：BOM、匯出者語系的標頭、公式注入防護；完成後通知、下載寫稽核', async () => {
      const admin = await login(ADMIN);
      await db
        .insert(users)
        .values({ email: 'formula@example.com', displayName: '=SUM(A1)', status: 'pending' });
      const created = await createExport(admin, {
        type: 'user',
        format: 'csv',
        scope: { kind: 'filter', filter: { keyword: 'formula' } },
      });
      const transfer = (created.body as { data: TransferBody }).data;
      expect(transfer.status).toBe('queued');

      await runExport(transfer.id);
      const done = await getTransfer(admin, transfer.id);
      expect(done).toMatchObject({ status: 'completed', totalRows: 1 });
      expect(done.outputName).toMatch(/^users-\d{8}-\d{4}\.csv$/);

      const text = outputOf(transfer.id).toString('utf8');
      expect(text.startsWith('﻿')).toBe(true);
      const [header, row] = text.slice(1).split('\r\n');
      expect(header).toBe('ID,Email,帳號,顯示名稱,狀態,角色,最後登入,已設定 MFA,建立時間');
      expect(row).toContain(",'=SUM(A1),待啟用,");

      const [notice] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.type, 'dataTransfer.exportFinished'));
      expect(notice?.params).toMatchObject({ status: 'completed', type: 'user', rows: 1 });

      const download = await request(http)
        .post(`/data-transfers/${transfer.id}/download`)
        .set('authorization', `Bearer ${admin}`)
        .expect(200);
      expect((download.body as { data: { url: string; fileName: string } }).data).toMatchObject({
        fileName: done.outputName,
      });
      const audits = await db.select().from(auditLogs).where(eq(auditLogs.resourceId, transfer.id));
      expect(audits.map((audit) => audit.action).toSorted()).toEqual([
        'dataTransfer.download',
        'dataTransfer.export',
      ]);
    });

    it('勾選範圍以當下的權限重新查詢：已刪除的使用者不出現；XLSX 可以讀回', async () => {
      const admin = await login(ADMIN);
      const [kept] = await db
        .insert(users)
        .values({ email: 'kept@example.com', displayName: 'Kept', status: 'active' })
        .returning();
      const [gone] = await db
        .insert(users)
        .values({
          email: 'gone@example.com',
          displayName: 'Gone',
          status: 'active',
          deletedAt: new Date(),
        })
        .returning();
      const created = await createExport(admin, {
        type: 'user',
        format: 'xlsx',
        scope: { kind: 'ids', ids: [kept!.id, gone!.id] },
        columns: ['email', 'displayName'],
      });
      const transfer = (created.body as { data: TransferBody }).data;
      expect(transfer.totalRows).toBe(1);
      await runExport(transfer.id);
      const done = await getTransfer(admin, transfer.id);
      expect(done.outputName).toMatch(/-selection\.xlsx$/);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(outputOf(transfer.id) as never);
      const sheet = workbook.worksheets[0]!;
      expect(sheet.name).toBe('使用者');
      expect(sheet.getRow(1).values).toEqual([undefined, 'Email', '顯示名稱']);
      expect(sheet.getRow(2).values).toEqual([undefined, 'kept@example.com', 'Kept']);
      expect(sheet.rowCount).toBe(2);
    });

    it('SQL：對外欄位的表、enum 輸出值代碼、字串跳脫', async () => {
      const admin = await login(ADMIN);
      await db
        .insert(users)
        .values({ email: 'quote@example.com', displayName: "O'Brien", status: 'inactive' });
      const created = await createExport(admin, {
        type: 'user',
        format: 'sql',
        scope: { kind: 'filter', filter: { keyword: 'quote' } },
        columns: ['email', 'displayName', 'status', 'roles'],
      });
      const transfer = (created.body as { data: TransferBody }).data;
      await runExport(transfer.id);
      const text = outputOf(transfer.id).toString('utf8');
      expect(text).toContain('CREATE TABLE IF NOT EXISTS "users_export"');
      expect(text).toContain('"display_name" text');
      expect(text).toContain('"roles" text[]');
      expect(text).toContain("('quote@example.com', 'O''Brien', 'inactive', '{}'::text[])");
      expect(text.trimEnd().endsWith('COMMIT;')).toBe(true);
    });

    it('欄位要有權讀：沒有 role:read 的人選了角色欄回 403', async () => {
      const limited = await createActiveUser(
        'dt-exporter@example.com',
        'ExporterPassword!2026',
        null,
      );
      const [role] = await db
        .insert(roles)
        .values({ slug: 'dt-exporter', name: '匯出者' })
        .returning();
      await db.insert(relationTuples).values([
        roleHolderTuple(role!.id, limited.id),
        {
          objectType: 'tenant',
          objectId: 'self',
          relation: 'user:export',
          subjectType: 'role',
          subjectId: role!.id,
          subjectRelation: 'holder',
        },
        {
          objectType: 'tenant',
          objectId: 'self',
          relation: 'user:read',
          subjectType: 'role',
          subjectId: role!.id,
          subjectRelation: 'holder',
        },
      ]);
      const token = await login({
        email: 'dt-exporter@example.com',
        password: 'ExporterPassword!2026',
      });
      const denied = await createExport(
        token,
        { type: 'user', scope: { kind: 'filter', filter: {} }, columns: ['email', 'roles'] },
        403,
      );
      expect((denied.body as { error: { code: string } }).error.code).toBe('AUTHZ_FORBIDDEN');
      await createExport(token, {
        type: 'user',
        scope: { kind: 'filter', filter: {} },
        columns: ['email'],
      });
    });

    it('稽核日誌的範圍最多 366 天', async () => {
      const auditor = await login(AUDITOR);
      const response = await createExport(
        auditor,
        {
          type: 'auditLog',
          scope: {
            kind: 'filter',
            filter: { from: '2024-01-01T00:00:00Z', to: '2025-06-01T00:00:00Z' },
          },
        },
        400,
      );
      expect((response.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    });

    it('下載當下重新檢查匯出權限；別人的傳輸一律 404', async () => {
      const auditor = await login(AUDITOR);
      const created = await createExport(auditor, {
        type: 'auditLog',
        scope: { kind: 'filter', filter: {} },
      });
      const transfer = (created.body as { data: TransferBody }).data;
      await runExport(transfer.id);

      const admin = await login(ADMIN);
      await request(http)
        .get(`/data-transfers/${transfer.id}`)
        .set('authorization', `Bearer ${admin}`)
        .expect(404);
      await request(http)
        .post(`/data-transfers/${transfer.id}/download`)
        .set('authorization', `Bearer ${admin}`)
        .expect(404);

      // 拿掉 auditor 角色的 auditLog:export
      const [auditorRole] = await db.select().from(roles).where(eq(roles.slug, 'auditor'));
      await db
        .delete(relationTuples)
        .where(
          and(
            eq(relationTuples.subjectId, auditorRole!.id),
            eq(relationTuples.relation, 'auditLog:export'),
          ),
        );
      await inTestTenant(app, async () => {
        const { PermissionService } = await import('@/modules/permission/permission.service');
        await app.get(PermissionService).permissionsChanged();
      });
      await request(http)
        .post(`/data-transfers/${transfer.id}/download`)
        .set('authorization', `Bearer ${auditor}`)
        .expect(403);
      await db.insert(relationTuples).values({
        objectType: 'tenant',
        objectId: 'self',
        relation: 'auditLog:export',
        subjectType: 'role',
        subjectId: auditorRole!.id,
        subjectRelation: 'holder',
      });
      await inTestTenant(app, async () => {
        const { PermissionService } = await import('@/modules/permission/permission.service');
        await app.get(PermissionService).permissionsChanged();
      });
    });

    it('取消要帶 version；每人同時進行的傳輸最多 3 個', async () => {
      const admin = await login(ADMIN);
      const ids: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        const created = await createExport(admin, {
          type: 'user',
          scope: { kind: 'filter', filter: {} },
        });
        ids.push((created.body as { data: TransferBody }).data.id);
      }
      const limited = await createExport(
        admin,
        { type: 'user', scope: { kind: 'filter', filter: {} } },
        429,
      );
      expect((limited.body as { error: { code: string } }).error.code).toBe(
        'DATA_TRANSFER_LIMIT_EXCEEDED',
      );

      const conflict = await request(http)
        .post(`/data-transfers/${ids[0]}/cancel`)
        .set('authorization', `Bearer ${admin}`)
        .send({ version: 99 })
        .expect(409);
      expect((conflict.body as { error: { code: string } }).error.code).toBe(
        'DATA_TRANSFER_VERSION_CONFLICT',
      );
      const cancelled = await request(http)
        .post(`/data-transfers/${ids[0]}/cancel`)
        .set('authorization', `Bearer ${admin}`)
        .send({ version: 1 })
        .expect(200);
      expect((cancelled.body as { data: TransferBody }).data.status).toBe('cancelled');
      // 已取消的工作不會再執行
      expect(await runExport(ids[0]!)).toEqual({ skipped: 'cancelled' });
      await createExport(admin, { type: 'user', scope: { kind: 'filter', filter: {} } });
    });
  });

  describe('匯入：分析與驗證', () => {
    it('標頭以任一語系的 label 比對；逐列驗證格式與資料庫重複', async () => {
      const admin = await login(ADMIN);
      const response = await analyze(
        admin,
        csv([
          'Email,Display name,Roles',
          `new-1@example.com,New One,系統管理員`,
          `not-an-email,Bad,`,
          `${AUDITOR.email},Taken,`,
          `new-2@example.com,,不存在的角色`,
        ]),
        'users.csv',
        { mode: 'create' },
      ).expect(200);
      const analysis = (response.body as { data: AnalysisOk }).data;
      expect(analysis.status).toBe('ok');
      expect(analysis.columns.map((column) => column.key)).toEqual([
        'email',
        'displayName',
        'roles',
      ]);
      expect(analysis.rows[0]).toEqual({
        rowNo: 1,
        sourceRow: 2,
        cells: { email: 'new-1@example.com', displayName: 'New One', roles: '系統管理員' },
      });
      const codes = analysis.results.map((result) =>
        result.issues.map((issue) => `${issue.column}:${issue.code}`),
      );
      expect(codes[0]).toEqual([]);
      expect(codes[1]).toEqual(['email:invalidFormat']);
      expect(codes[2]).toEqual(['email:alreadyExists']);
      expect(codes[3]).toEqual(
        expect.arrayContaining(['roles:referenceNotFound', 'displayName:required']),
      );
    });

    it('不認得的標頭要使用者決定；帶 mapping 重送同一個檔案', async () => {
      const admin = await login(ADMIN);
      const file = csv(['信箱,全名,部門', 'map@example.com,Mapped,Sales']);
      const first = await analyze(admin, file, 'users.csv', { mode: 'create' }).expect(200);
      const needs = (
        first.body as {
          data: { status: string; headers: { index: number; suggestion: string | null }[] };
        }
      ).data;
      expect(needs.status).toBe('needsMapping');
      expect(needs.headers.map((header) => header.suggestion)).toEqual(['email', null, null]);

      const second = await analyze(admin, file, 'users.csv', {
        mode: 'create',
        mapping: JSON.stringify({ 0: 'email', 1: 'displayName', 2: null }),
      }).expect(200);
      const analysis = (second.body as { data: AnalysisOk }).data;
      expect(analysis.status).toBe('ok');
      expect(analysis.ignored).toEqual([{ header: '部門', reason: 'unmapped' }]);
      expect(analysis.results[0]!.issues).toEqual([]);
    });

    it('沒有 BOM 又不是 UTF-8 的 CSV 以 Big5 解碼', async () => {
      const admin = await login(ADMIN);
      const big5 = Buffer.from(
        // 「Email,顯示名稱\r\nbig5@example.com,王小明\r\n」的 Big5 位元組
        '456d61696c2cc5e3a5dca657bad90d0a62696735406578616d706c652e636f6d2ca4fda470a9fa0d0a',
        'hex',
      );
      const response = await analyze(admin, big5, 'big5.csv', { mode: 'create' }).expect(200);
      const analysis = (response.body as { data: AnalysisOk }).data;
      expect(analysis.rows[0]?.cells).toEqual({ email: 'big5@example.com', displayName: '王小明' });
    });

    it('XLSX：讀第一個工作表，日期儲存格與數字轉成字串', async () => {
      const admin = await login(ADMIN);
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Users');
      sheet.addRow(['email', 'displayName']);
      sheet.addRow(['xlsx@example.com', 12345]);
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      const response = await analyze(admin, buffer, 'users.xlsx', { mode: 'create' }).expect(200);
      const analysis = (response.body as { data: AnalysisOk }).data;
      expect(analysis.rows[0]?.cells).toEqual({ email: 'xlsx@example.com', displayName: '12345' });
    });

    it('超過列數上限不截斷，回 422', async () => {
      const admin = await login(ADMIN);
      const lines = [
        'email,displayName',
        ...Array.from({ length: 101 }, (_, i) => `u${i}@example.com,U${i}`),
      ];
      const { setTestTenantFeatureParams } = await import('./tenant');
      await setTestTenantFeatureParams(app, { 'dataTransfer.importMaxRows': 100 });
      try {
        const response = await analyze(admin, csv(lines), 'many.csv', { mode: 'create' }).expect(
          422,
        );
        expect((response.body as { error: { code: string; details: object } }).error).toMatchObject(
          {
            code: 'DATA_TRANSFER_TOO_MANY_ROWS',
            details: { max: 100, count: 101 },
          },
        );
      } finally {
        await setTestTenantFeatureParams(app, {});
      }
    });

    it('沒有該模式的權限回 403；validate 只驗送來的列', async () => {
      const auditor = await login(AUDITOR);
      await analyze(auditor, csv(['email,displayName', 'a@example.com,A']), 'a.csv', {
        mode: 'create',
      }).expect(403);
      const admin = await login(ADMIN);
      const response = await request(http)
        .post('/data-transfers/importers/user/validate')
        .set('authorization', `Bearer ${admin}`)
        .send({
          mode: 'create',
          rows: [{ rowNo: 7, cells: { email: 'ok@example.com', displayName: '' } }],
        })
        .expect(200);
      expect((response.body as { data: { rows: AnalysisOk['results'] } }).data.rows).toEqual([
        { rowNo: 7, issues: [{ column: 'displayName', code: 'required', severity: 'error' }] },
      ]);
    });
  });

  describe('匯入：套用', () => {
    it('新增模式：每列一個交易，角色一起指派；稽核的 actor 是建立者並標出來源；重跑不重複建立', async () => {
      const admin = await login(ADMIN);
      const created = await request(http)
        .post('/data-transfers/imports')
        .set('authorization', `Bearer ${admin}`)
        .send({
          type: 'user',
          mode: 'create',
          fileName: 'new-users.csv',
          rows: [
            {
              rowNo: 1,
              sourceRow: 2,
              cells: { email: 'imp-1@example.com', displayName: 'Imp 1', roles: '稽核人員' },
            },
            {
              rowNo: 2,
              sourceRow: 3,
              cells: { email: 'imp-2@example.com', displayName: 'Imp 2', roles: '' },
            },
            // 竄改過的列（前端不會送出）：工作重新驗證時擋下
            {
              rowNo: 3,
              sourceRow: 4,
              cells: { email: 'broken', displayName: 'Broken', roles: '' },
            },
          ],
        })
        .expect(202);
      const transfer = (created.body as { data: TransferBody }).data;
      expect(transfer.status).toBe('queued');

      await runApply(transfer.id);
      const done = await getTransfer(admin, transfer.id);
      expect(done).toMatchObject({
        status: 'completed',
        succeededRows: 2,
        failedRows: 1,
        skippedRows: 0,
      });

      const [imported] = await db.select().from(users).where(eq(users.email, 'imp-1@example.com'));
      expect(imported?.status).toBe('pending');
      const [auditorRole] = await db.select().from(roles).where(eq(roles.slug, 'auditor'));
      const held = await db
        .select()
        .from(relationTuples)
        .where(
          and(
            eq(relationTuples.subjectId, imported!.id),
            eq(relationTuples.objectId, auditorRole!.id),
          ),
        );
      expect(held).toHaveLength(1);

      const [audit] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'user.create'), eq(auditLogs.resourceId, imported!.id)));
      expect(audit?.actorEmail).toBe(ADMIN.email);
      expect(audit?.metadata).toMatchObject({ via: 'import', transferId: transfer.id });

      const rows = await request(http)
        .get(`/data-transfers/${transfer.id}/rows?outcome=failed`)
        .set('authorization', `Bearer ${admin}`)
        .expect(200);
      const failed = (
        rows.body as { data: { items: { rowNo: number; error: { code: string } }[] } }
      ).data.items;
      expect(failed.map((row) => [row.rowNo, row.error.code])).toEqual([[3, 'VALIDATION_FAILED']]);

      // 重試（工作中斷後重跑）：只處理還是 pending 的列，成功的不會建兩次
      await db
        .update(dataTransfers)
        .set({ status: 'applying' })
        .where(eq(dataTransfers.id, transfer.id));
      await runApply(transfer.id);
      const [count] = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(users)
        .where(sql`${users.email} IN ('imp-1@example.com', 'imp-2@example.com')`);
      expect(count?.value).toBe(2);

      const [notice] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.type, 'dataTransfer.importFinished'));
      expect(notice?.params).toMatchObject({ status: 'completed', succeeded: 2, failed: 1 });
    });

    it('修改模式：匯出的檔案改過後匯回；顯示目前值與變更；預覽後被別人改過的列衝突', async () => {
      const admin = await login(ADMIN);
      const [alice] = await db
        .insert(users)
        .values({ email: 'alice@example.com', displayName: 'Alice', status: 'active' })
        .returning();
      const [bob] = await db
        .insert(users)
        .values({ email: 'bob@example.com', displayName: 'Bob', status: 'active' })
        .returning();
      const [carol] = await db
        .insert(users)
        .values({ email: 'carol@example.com', displayName: 'Carol', status: 'pending' })
        .returning();

      const file = csv([
        'ID,Email,顯示名稱,狀態',
        `${alice!.id},alice@example.com,Alice Chen,停用`,
        `,BOB@example.com,Bob,啟用`,
        `${carol!.id},carol@example.com,Carol,啟用`,
      ]);
      const response = await analyze(admin, file, 'users.csv', { mode: 'update' }).expect(200);
      const analysis = (response.body as { data: AnalysisOk }).data;
      const [a, b, c] = analysis.results;
      expect(a?.target).toMatchObject({
        id: alice!.id,
        current: { displayName: 'Alice', status: '啟用' },
      });
      expect(a?.changed).toEqual(['displayName', 'status']);
      expect(b?.target?.id).toBe(bob!.id);
      expect(b?.issues).toEqual([{ column: null, code: 'noChanges', severity: 'warning' }]);
      expect(c?.issues.map((issue) => issue.code)).toEqual(['transitionNotAllowed']);

      // 預覽之後 bob 被別人改了，alice 沒有
      await db
        .update(users)
        .set({ version: sql`${users.version} + 1` })
        .where(eq(users.id, bob!.id));
      const created = await request(http)
        .post('/data-transfers/imports')
        .set('authorization', `Bearer ${admin}`)
        .send({
          type: 'user',
          mode: 'update',
          skipInvalid: true,
          rows: [
            {
              rowNo: 1,
              cells: analysis.rows[0]!.cells,
              target: { id: alice!.id, version: a!.target!.version },
            },
            {
              rowNo: 2,
              cells: { ...analysis.rows[1]!.cells, displayName: 'Bobby' },
              target: { id: bob!.id, version: b!.target!.version },
            },
          ],
        })
        .expect(202);
      const transfer = (created.body as { data: TransferBody }).data;
      await runApply(transfer.id);
      const done = await getTransfer(admin, transfer.id);
      expect(done).toMatchObject({ succeededRows: 1, failedRows: 1 });

      const [updatedAlice] = await db.select().from(users).where(eq(users.id, alice!.id));
      expect(updatedAlice).toMatchObject({ displayName: 'Alice Chen', status: 'inactive' });
      const applyRows = await db
        .select()
        .from(dataTransferRows)
        .where(eq(dataTransferRows.transferId, transfer.id));
      const byRow = new Map(applyRows.map((row) => [row.rowNo, row]));
      expect(byRow.get(1)?.changes).toEqual({
        displayName: ['Alice', 'Alice Chen'],
        status: ['啟用', '停用'],
      });
      expect(byRow.get(2)?.outcomeError).toMatchObject({ code: 'USER_VERSION_CONFLICT' });

      const report = await request(http)
        .get(`/data-transfers/${transfer.id}/report?format=csv&rows=failed`)
        .set('authorization', `Bearer ${admin}`)
        .expect(200);
      expect(report.headers['content-type']).toContain('text/csv');
      const lines = report.text.replace('﻿', '').trim().split('\r\n');
      expect(lines[0]).toBe('ID,Email,顯示名稱,狀態,列號,結果,錯誤');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain('USER_VERSION_CONFLICT');
    });

    it('不能修改自己的狀態（selfModify）', async () => {
      const admin = await login(ADMIN);
      const [self] = await db.select().from(users).where(eq(users.email, ADMIN.email));
      const response = await request(http)
        .post('/data-transfers/importers/user/validate')
        .set('authorization', `Bearer ${admin}`)
        .send({ mode: 'update', rows: [{ rowNo: 1, cells: { id: self!.id, status: '停用' } }] })
        .expect(200);
      const [row] = (response.body as { data: { rows: AnalysisOk['results'] } }).data.rows;
      expect(row?.issues).toEqual([{ column: 'status', code: 'selfModify', severity: 'error' }]);
    });

    it('範本：新增模式只含可匯入的欄位；修改模式預先填入現有資料', async () => {
      const admin = await login(ADMIN);
      const create = await request(http)
        .get('/data-transfers/importers/user/template?mode=create&format=csv')
        .set('authorization', `Bearer ${admin}`)
        .set('accept-language', 'en-US')
        .expect(200);
      expect(create.headers['content-disposition']).toContain('users-template-create.csv');
      expect(create.text.replace('﻿', '').split('\r\n')[0]).toBe(
        'Email,Username,Display name,Roles',
      );

      const update = await request(http)
        .get('/data-transfers/importers/user/template?mode=update&format=xlsx')
        .set('authorization', `Bearer ${admin}`)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(update.body as never);
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['使用者', '欄位說明']);
      expect(workbook.worksheets[0]!.rowCount).toBeGreaterThan(1);
    });
  });

  describe('JSON／YAML、自動完成、手動指定比對目標（§6.5、§7.3、§7.5）', () => {
    const validate = (token: string, body: object) =>
      request(http)
        .post('/data-transfers/importers/user/validate')
        .set('authorization', `Bearer ${token}`)
        .send(body);

    it('分析 JSON 與 YAML：以欄位 key 為標頭，多值的陣列轉成 ; 串接', async () => {
      const admin = await login(ADMIN);
      const json = Buffer.from(
        JSON.stringify({
          users: [{ email: 'json-1@example.com', displayName: 'Json 1', roles: ['稽核人員'] }],
        }),
      );
      const fromJson = await analyze(admin, json, 'users.json', { mode: 'create' }).expect(200);
      const okJson = (fromJson.body as { data: AnalysisOk }).data;
      expect(okJson.status).toBe('ok');
      expect(okJson.rows[0]?.cells).toEqual({
        email: 'json-1@example.com',
        displayName: 'Json 1',
        roles: '稽核人員',
      });
      expect(okJson.results[0]?.issues).toEqual([]);

      await db.insert(users).values({ email: 'yaml-1@example.com', displayName: 'Yaml 1' });
      const yaml = Buffer.from('- email: yaml-1@example.com\n  displayName: Yaml One\n');
      const fromYaml = await analyze(admin, yaml, 'users.yml', { mode: 'update' }).expect(200);
      const okYaml = (fromYaml.body as { data: AnalysisOk }).data;
      expect(okYaml.results[0]).toMatchObject({ changed: ['displayName'] });

      const broken = await analyze(admin, Buffer.from('[1, 2]'), 'users.json', {
        mode: 'create',
      }).expect(422);
      expect((broken.body as { error: { code: string } }).error.code).toBe(
        'DATA_TRANSFER_FILE_UNREADABLE',
      );
    });

    it('範本也有 JSON／YAML：以欄位 key 為鍵、多值是陣列', async () => {
      const admin = await login(ADMIN);
      const response = await request(http)
        .get('/data-transfers/importers/user/template?mode=create&format=json')
        .set('authorization', `Bearer ${admin}`)
        .buffer(true)
        .parse((res, done) => {
          let text = '';
          res.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
          res.on('end', () => done(null, text));
        })
        .expect(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(JSON.parse(response.body as string)).toEqual([
        { email: 'alice@example.com', username: 'alice', displayName: 'Alice Chen', roles: [] },
      ]);
    });

    it('自動完成：Email 欄建議現有的值；沒有 suggest 的文字欄不能查', async () => {
      const admin = await login(ADMIN);
      await db.insert(users).values({ email: 'suggest-me@example.com', displayName: 'Suggest' });
      const found = await request(http)
        .get('/data-transfers/importers/user/columns/email/options?keyword=suggest')
        .set('authorization', `Bearer ${admin}`)
        .expect(200);
      expect(
        (found.body as { data: { items: { id: string; label: string }[] } }).data.items,
      ).toEqual([{ id: 'suggest-me@example.com', label: 'suggest-me@example.com' }]);
      await request(http)
        .get('/data-transfers/importers/user/columns/displayName/options?keyword=a')
        .set('authorization', `Bearer ${admin}`)
        .expect(400);
    });

    it('比對目標的下拉選單：要有修改模式的權限', async () => {
      const admin = await login(ADMIN);
      const [target] = await db
        .insert(users)
        .values({ email: 'pick-me@example.com', displayName: 'Pick Me' })
        .returning();
      const found = await request(http)
        .get('/data-transfers/importers/user/targets?keyword=pick-me')
        .set('authorization', `Bearer ${admin}`)
        .expect(200);
      expect((found.body as { data: { items: unknown[] } }).data.items).toEqual([
        { id: target!.id, label: 'pick-me@example.com', description: 'Pick Me' },
      ]);
      await request(http)
        .get('/data-transfers/importers/user/targets')
        .set('authorization', `Bearer ${await login(MEMBER)}`)
        .expect(403);
    });

    it('驗證：手動指定的目標取代比對鍵；撤回比對是錯誤；指定不存在的紀錄找不到', async () => {
      const admin = await login(ADMIN);
      const [target] = await db
        .insert(users)
        .values({ email: 'manual@example.com', displayName: 'Manual' })
        .returning();
      const response = await validate(admin, {
        mode: 'update',
        rows: [
          {
            rowNo: 1,
            cells: { email: 'typo@example.com', displayName: 'Manual 2' },
            targetId: target!.id,
          },
          { rowNo: 2, cells: { email: 'manual@example.com', displayName: 'X' }, targetId: null },
          {
            rowNo: 3,
            cells: { displayName: 'Y' },
            targetId: '00000000-0000-4000-8000-000000000000',
          },
        ],
      }).expect(200);
      const rows = (response.body as { data: { rows: AnalysisOk['results'] } }).data.rows;
      expect(rows[0]).toMatchObject({
        issues: [],
        target: { id: target!.id, current: { email: 'manual@example.com', displayName: 'Manual' } },
        // Email 是比對鍵，不會被修改
        changed: ['displayName'],
      });
      expect(rows[1]?.issues.map((issue) => issue.code)).toEqual(['targetNotSelected']);
      expect(rows[1]?.target).toBeUndefined();
      expect(rows[2]?.issues.map((issue) => issue.code)).toEqual(['targetNotFound']);
    });

    it('套用：工作照用手動指定的目標；撤回比對的列略過，不會改用 Email 自動比對', async () => {
      const admin = await login(ADMIN);
      const [picked] = await db
        .insert(users)
        .values({ email: 'picked@example.com', displayName: 'Picked' })
        .returning();
      const [untouched] = await db
        .insert(users)
        .values({ email: 'untouched@example.com', displayName: 'Untouched' })
        .returning();
      const created = await request(http)
        .post('/data-transfers/imports')
        .set('authorization', `Bearer ${admin}`)
        .send({
          type: 'user',
          mode: 'update',
          skipInvalid: true,
          rows: [
            {
              rowNo: 1,
              cells: { email: 'nobody@example.com', displayName: 'Picked 2' },
              targetId: picked!.id,
              target: { id: picked!.id, version: picked!.version },
            },
            {
              rowNo: 2,
              cells: { email: 'untouched@example.com', displayName: 'Should Not Change' },
              targetId: null,
            },
          ],
        })
        .expect(202);
      const transfer = (created.body as { data: TransferBody }).data;
      const stored = await db
        .select()
        .from(dataTransferRows)
        .where(eq(dataTransferRows.transferId, transfer.id));
      expect(
        stored
          .toSorted((a, b) => a.rowNo - b.rowNo)
          .map((row) => [row.rowNo, row.targetManual, row.targetId]),
      ).toEqual([
        [1, true, picked!.id],
        [2, true, null],
      ]);

      await runApply(transfer.id);
      expect(await getTransfer(admin, transfer.id)).toMatchObject({
        status: 'completed',
        succeededRows: 1,
        skippedRows: 1,
      });
      const [after] = await db.select().from(users).where(eq(users.id, picked!.id));
      expect(after?.displayName).toBe('Picked 2');
      const [same] = await db.select().from(users).where(eq(users.id, untouched!.id));
      expect(same?.displayName).toBe('Untouched');
    });

    it('匯出 JSON：以欄位 key 為鍵，enum 是值代碼', async () => {
      const admin = await login(ADMIN);
      await db
        .insert(users)
        .values({ email: 'export-json@example.com', displayName: 'Export', status: 'active' });
      const created = await createExport(admin, {
        type: 'user',
        format: 'json',
        scope: { kind: 'filter', filter: { keyword: 'export-json' } },
        columns: ['email', 'status', 'roles'],
      });
      const transfer = (created.body as { data: TransferBody }).data;
      await runExport(transfer.id);
      expect((await getTransfer(admin, transfer.id)).outputName).toMatch(/\.json$/);
      expect(JSON.parse(outputOf(transfer.id).toString('utf8'))).toEqual([
        { email: 'export-json@example.com', status: 'active', roles: [] },
      ]);
    });
  });

  describe('清理（§10）', () => {
    it('到期的傳輸：刪除匯出檔與套用列、標成 expired；超過 90 天的紀錄刪除', async () => {
      const admin = await login(ADMIN);
      const created = await createExport(admin, {
        type: 'user',
        scope: { kind: 'filter', filter: {} },
      });
      const transfer = (created.body as { data: TransferBody }).data;
      await runExport(transfer.id);
      await db
        .update(dataTransfers)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(dataTransfers.id, transfer.id));
      const [owner] = await db.select().from(users).where(eq(users.email, ADMIN.email));
      const [old] = await db
        .insert(dataTransfers)
        .values({
          direction: 'export',
          type: 'user',
          format: 'csv',
          status: 'expired',
          createdBy: owner!.id,
          locale: 'zh-TW',
          timezone: 'Asia/Taipei',
          params: {},
          expiresAt: new Date(),
          createdAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000),
        })
        .returning();

      const report = await inTestTenant(app, () => app.get(DataTransferCleanupService).run());
      expect(report).toMatchObject({ expired: 1, deleted: 1, failed: 0 });
      expect((await getTransfer(admin, transfer.id)).status).toBe('expired');
      expect(
        [...storage.contents.keys()].some((key) => key.startsWith(`transfers/${transfer.id}/`)),
      ).toBe(false);
      await request(http)
        .get(`/data-transfers/${old!.id}`)
        .set('authorization', `Bearer ${admin}`)
        .expect(404);
      const expired = await request(http)
        .post(`/data-transfers/${transfer.id}/download`)
        .set('authorization', `Bearer ${admin}`)
        .expect(410);
      expect((expired.body as { error: { code: string } }).error.code).toBe(
        'DATA_TRANSFER_EXPIRED',
      );
    });
  });

  it('沒有登入的人看不到任何端點；一般成員的「我的匯入匯出」是空的', async () => {
    await request(http).get('/data-transfers').expect(401);
    const member = await login(MEMBER);
    const response = await request(http)
      .get('/data-transfers')
      .set('authorization', `Bearer ${member}`)
      .expect(200);
    expect((response.body as { data: { items: unknown[] } }).data.items).toEqual([]);
  });
});
