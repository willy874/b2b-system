import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { JobContext } from '@/core/jobs';
import { ObjectStorage } from '@/core/storage';
import {
  approvalRequests,
  dataTransferRows,
  dataTransfers,
  groups,
  orgUnitMembers,
  orgUnits,
  relationTuples,
  roleHolderTuple,
  roles,
  tags,
  users,
} from '@/db/schema';
import { registerDataTransferBodyParser } from '@/modules/data-transfer/data-transfer.http';
import { DataTransferExportService } from '@/modules/data-transfer/export/data-transfer-export.service';
import { DataTransferApplyService } from '@/modules/data-transfer/import/data-transfer-apply.service';

import type { TestDatabase } from './db';
import { createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { InMemoryObjectStorage } from './in-memory-object-storage';
import { inTestTenant } from './tenant';

/**
 * 匯入匯出擴充到角色、群組、組織、標籤、審批、服務帳號（docs/architecture/backend/22-data-transfer.md §12）
 * 與同一份檔案內的引用（§7.8）。框架本身的行為在 data-transfer.spec.ts。
 */

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;
const storage = new InMemoryObjectStorage();

const SUPER_ADMIN = { email: 'dtr-root@example.com', password: 'Quiet-Harbor-Lantern-26' };
const ADMIN = { email: 'dtr-admin@example.com', password: 'AdminPassword!2026' };
const AUDITOR = { email: 'dtr-auditor@example.com', password: 'AuditorPassword!2026' };

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
  totalRows: number;
  succeededRows: number;
  failedRows: number;
  skippedRows: number;
}

interface Issue {
  column: string | null;
  code: string;
  severity: string;
  params?: Record<string, unknown>;
}

const job = (): JobContext => ({
  id: 'test-job',
  retryCount: 0,
  signal: new AbortController().signal,
});

function outputOf(transferId: string): string {
  const key = [...storage.contents.keys()].find((item) =>
    item.startsWith(`transfers/${transferId}/`),
  );
  if (!key) throw new Error(`找不到 ${transferId} 的匯出檔`);
  return storage.contents.get(key)!.toString('utf8').replace(/^﻿/, '');
}

async function exportCsv(token: string, type: string, filter: object = {}): Promise<string[]> {
  const created = await request(http)
    .post('/data-transfers/exports')
    .set('authorization', `Bearer ${token}`)
    .set('accept-language', 'zh-TW')
    .set('x-client-timezone', 'Asia/Taipei')
    .send({ type, format: 'csv', scope: { kind: 'filter', filter } })
    .expect(202);
  const transfer = (created.body as { data: TransferBody }).data;
  await inTestTenant(app, () => app.get(DataTransferExportService).run(transfer.id, job()));
  const done = await getTransfer(token, transfer.id);
  expect(done.status).toBe('completed');
  return outputOf(transfer.id).split('\r\n').filter(Boolean);
}

async function getTransfer(token: string, id: string): Promise<TransferBody> {
  const response = await request(http)
    .get(`/data-transfers/${id}`)
    .set('authorization', `Bearer ${token}`)
    .expect(200);
  return (response.body as { data: TransferBody }).data;
}

async function validate(
  token: string,
  type: string,
  mode: 'create' | 'update',
  rows: Array<{ rowNo: number; cells: Record<string, string> }>,
  fileKeys?: Record<string, string[]>,
): Promise<Array<{ rowNo: number; issues: Issue[]; changed?: string[] }>> {
  const response = await request(http)
    .post(`/data-transfers/importers/${type}/validate`)
    .set('authorization', `Bearer ${token}`)
    .set('accept-language', 'zh-TW')
    .send({ mode, rows, ...(fileKeys ? { fileKeys } : {}) })
    .expect(200);
  return (response.body as { data: { rows: Array<{ rowNo: number; issues: Issue[] }> } }).data.rows;
}

/** 送出套用並執行工作；回傳完成的傳輸與每一列的結果。 */
async function importRows(
  token: string,
  type: string,
  mode: 'create' | 'update',
  rows: Array<{ rowNo: number; cells: Record<string, string> }>,
) {
  const created = await request(http)
    .post('/data-transfers/imports')
    .set('authorization', `Bearer ${token}`)
    .send({ type, mode, skipInvalid: true, rows })
    .expect(202);
  const transfer = (created.body as { data: TransferBody }).data;
  await inTestTenant(app, () => app.get(DataTransferApplyService).run(transfer.id, job()));
  const outcomes = await db
    .select()
    .from(dataTransferRows)
    .where(eq(dataTransferRows.transferId, transfer.id));
  return {
    transfer: await getTransfer(token, transfer.id),
    outcome: (rowNo: number) => outcomes.find((row) => row.rowNo === rowNo),
  };
}

const codesOf = (row: { issues: Issue[] } | undefined) => row?.issues.map((issue) => issue.code);

describe('匯入匯出：其他資源（docs/architecture/backend/22-data-transfer.md §12）', () => {
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

  it('資源清單依權限：admin 看得到全部新資源與它們的匯入模式；auditor 只多審批的匯出', async () => {
    const list = async (token: string) => {
      const response = await request(http)
        .get('/data-transfers/resources')
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      return (response.body as { data: { items: Array<{ type: string; importModes: string[] }> } })
        .data.items;
    };
    const admin = new Map((await list(await login(ADMIN))).map((item) => [item.type, item]));
    for (const type of ['role', 'group', 'orgUnit', 'orgUnitMember', 'tag']) {
      expect(admin.get(type)?.importModes).toEqual(['create', 'update']);
    }
    expect(admin.get('groupMember')?.importModes).toEqual(['create']);
    for (const type of ['approvalRequest', 'approvalDecision', 'serviceAccount']) {
      expect(admin.get(type)?.importModes).toEqual([]);
    }
    const auditor = (await list(await login(AUDITOR))).map((item) => item.type).toSorted();
    expect(auditor).toEqual(['approvalDecision', 'approvalRequest', 'auditLog']);
  });

  describe('角色（§13.1）', () => {
    it('匯出帶 slug 與權限鍵；以同一份檔案在新增模式建立（指定 slug）', async () => {
      const admin = await login(ADMIN);
      const lines = await exportCsv(admin, 'role', { keyword: 'auditor' });
      expect(lines[0]).toBe('ID,代碼,名稱,說明,權限,系統角色,直接持有的人數,建立時間');
      expect(lines[1]).toContain(',auditor,稽核人員,');
      expect(lines[1]).toContain('auditLog:export;');

      const { transfer } = await importRows(admin, 'role', 'create', [
        {
          rowNo: 1,
          cells: {
            slug: 'support-agent',
            name: 'Support agent',
            permissions: 'user:read;role:read',
          },
        },
      ]);
      expect(transfer).toMatchObject({ status: 'completed', succeededRows: 1 });
      const [created] = await db.select().from(roles).where(eq(roles.slug, 'support-agent'));
      expect(created?.name).toBe('Support agent');
      const keys = await db
        .select({ key: relationTuples.relation })
        .from(relationTuples)
        .where(
          and(eq(relationTuples.subjectId, created!.id), eq(relationTuples.subjectType, 'role')),
        );
      expect(keys.map((row) => row.key).toSorted()).toEqual(['role:read', 'user:read']);
    });

    it('反提權：授予自己沒有的權限 → permissionNotGrantable；super-admin 不可修改 → immutable', async () => {
      const admin = await login(ADMIN);
      // admin 沒有 mfaPolicy:update（預設只給 super-admin）
      const [created] = await validate(admin, 'role', 'create', [
        { rowNo: 1, cells: { name: 'Escalated', permissions: 'mfaPolicy:update' } },
      ]);
      expect(created?.issues).toContainEqual(
        expect.objectContaining({
          column: 'permissions',
          code: 'permissionNotGrantable',
          params: { names: ['mfaPolicy:update'] },
        }),
      );
      const [superAdmin] = await validate(admin, 'role', 'update', [
        { rowNo: 1, cells: { slug: 'super-admin', name: 'Root' } },
      ]);
      expect(codesOf(superAdmin)).toContain('immutable');
    });

    it('修改模式：以 slug 比對，名稱與權限鍵整組取代', async () => {
      const admin = await login(ADMIN);
      await importRows(admin, 'role', 'create', [
        { rowNo: 1, cells: { slug: 'editor-x', name: 'Editor X', permissions: 'user:read' } },
      ]);
      const [preview] = await validate(admin, 'role', 'update', [
        { rowNo: 1, cells: { slug: 'editor-x', name: 'Editor Y', permissions: 'role:read' } },
      ]);
      expect(preview?.changed?.toSorted()).toEqual(['name', 'permissions']);
      const { transfer } = await importRows(admin, 'role', 'update', [
        { rowNo: 1, cells: { slug: 'editor-x', name: 'Editor Y', permissions: 'role:read' } },
      ]);
      expect(transfer.succeededRows).toBe(1);
      const [role] = await db.select().from(roles).where(eq(roles.slug, 'editor-x'));
      expect(role?.name).toBe('Editor Y');
      const keys = await db
        .select({ key: relationTuples.relation })
        .from(relationTuples)
        .where(and(eq(relationTuples.subjectId, role!.id), eq(relationTuples.subjectType, 'role')));
      expect(keys.map((row) => row.key)).toEqual(['role:read']);
    });
  });

  describe('群組與群組成員（§13.2）', () => {
    it('建立群組並持有角色；不能持有 super-admin', async () => {
      const admin = await login(ADMIN);
      const [forbidden] = await validate(admin, 'group', 'create', [
        { rowNo: 1, cells: { name: 'Roots', roles: 'super-admin' } },
      ]);
      expect(codesOf(forbidden)).toContain('superAdminForbidden');

      const { transfer } = await importRows(admin, 'group', 'create', [
        { rowNo: 1, cells: { name: 'Auditors team', roles: '稽核人員' } },
      ]);
      expect(transfer.succeededRows).toBe(1);
      const lines = await exportCsv(admin, 'group', { keyword: 'Auditors team' });
      expect(lines[1]).toContain(',Auditors team,,稽核人員,0,');
    });

    it('成員：使用者與成員群組擇一；已是成員、把自己加入、把群組放進自己都擋下；套用後匯出', async () => {
      const admin = await login(ADMIN);
      await createActiveUser('member-a@example.com', 'MemberPassword!2026', null);
      await importRows(admin, 'group', 'create', [
        { rowNo: 1, cells: { name: 'Outer' } },
        { rowNo: 2, cells: { name: 'Inner' } },
      ]);
      const issues = await validate(admin, 'groupMember', 'create', [
        { rowNo: 1, cells: { group: 'Outer' } },
        { rowNo: 2, cells: { group: 'Outer', user: 'member-a@example.com', memberGroup: 'Inner' } },
        { rowNo: 3, cells: { group: 'Outer', user: ADMIN.email } },
        { rowNo: 4, cells: { group: 'Outer', memberGroup: 'Outer' } },
      ]);
      expect(issues.map(codesOf)).toEqual([
        ['required'],
        ['exactlyOne'],
        ['selfModify'],
        ['membershipCycle'],
      ]);

      const { transfer } = await importRows(admin, 'groupMember', 'create', [
        { rowNo: 1, cells: { group: 'Outer', user: 'member-a@example.com' } },
        { rowNo: 2, cells: { group: 'Outer', memberGroup: 'Inner' } },
      ]);
      expect(transfer.succeededRows).toBe(2);
      const [again] = await validate(admin, 'groupMember', 'create', [
        { rowNo: 1, cells: { group: 'Outer', user: 'member-a@example.com' } },
      ]);
      expect(codesOf(again)).toEqual(['alreadyExists']);

      const [outer] = await db.select().from(groups).where(eq(groups.name, 'Outer'));
      const lines = await exportCsv(admin, 'groupMember', { groupId: outer!.id });
      expect(lines.slice(1)).toEqual([
        'Outer,,Inner,Inner',
        'Outer,member-a@example.com,,member-a@example.com',
      ]);
    });
  });

  describe('組織（§13.3、同檔引用 §7.8）', () => {
    beforeEach(async () => {
      await db.delete(orgUnitMembers);
      await db.delete(orgUnits);
    });

    it('上層可以引用檔案裡的其他列：子部門寫在上層之前也依相依順序建立', async () => {
      const admin = await login(ADMIN);
      const rows: Array<{ rowNo: number; cells: Record<string, string> }> = [
        { rowNo: 1, cells: { code: 'SALES-N', name: '北區', parent: 'SALES' } },
        { rowNo: 2, cells: { code: 'SALES', name: '業務部', parent: 'HQ' } },
        { rowNo: 3, cells: { code: 'HQ', name: '總部' } },
      ];
      // 預覽的 validate 只送改過的列：檔案裡有的值放在 fileKeys
      const [onlyFirst] = await validate(admin, 'orgUnit', 'create', [rows[0]!]);
      expect(codesOf(onlyFirst)).toEqual(['referenceNotFound']);
      const [withKeys] = await validate(admin, 'orgUnit', 'create', [rows[0]!], {
        code: ['SALES'],
      });
      expect(withKeys?.issues).toEqual([]);

      const { transfer } = await importRows(admin, 'orgUnit', 'create', rows);
      expect(transfer).toMatchObject({ succeededRows: 3, failedRows: 0 });
      const units = await db.select().from(orgUnits);
      const byCode = new Map(units.map((unit) => [unit.code, unit]));
      expect(byCode.get('HQ')?.parentId).toBeNull();
      expect(byCode.get('SALES')?.parentId).toBe(byCode.get('HQ')?.id);
      expect(byCode.get('SALES-N')?.parentId).toBe(byCode.get('SALES')?.id);

      // 匯出依組織樹排序（上層在前），上層以代碼表示
      const lines = await exportCsv(admin, 'orgUnit');
      expect(lines.slice(1).map((line) => line.split(',').slice(1, 4).join(','))).toEqual([
        'HQ,總部,',
        'SALES,業務部,HQ',
        'SALES-N,北區,SALES',
      ]);
    });

    it('同檔引用的循環（含引用自己）→ referenceCycle；被引用的列失敗時引用它的列 referenceFailed', async () => {
      const admin = await login(ADMIN);
      const issues = await validate(admin, 'orgUnit', 'create', [
        { rowNo: 1, cells: { code: 'A', name: 'A', parent: 'B' } },
        { rowNo: 2, cells: { code: 'B', name: 'B', parent: 'A' } },
        { rowNo: 3, cells: { code: 'C', name: 'C', parent: 'C' } },
      ]);
      expect(issues.map(codesOf)).toEqual([
        ['referenceCycle'],
        ['referenceCycle'],
        ['referenceCycle'],
      ]);

      await importRows(admin, 'orgUnit', 'create', [
        { rowNo: 1, cells: { code: 'OLD', name: '既有' } },
      ]);
      const { transfer, outcome } = await importRows(admin, 'orgUnit', 'create', [
        { rowNo: 1, cells: { code: 'CHILD', name: '下層', parent: 'Z' } },
        // 最上層已經有同名的部門：驗證失敗、略過，引用它的列找不到被引用的 id
        { rowNo: 2, cells: { code: 'Z', name: '既有' } },
      ]);
      expect(transfer).toMatchObject({ succeededRows: 0, failedRows: 1, skippedRows: 1 });
      expect(outcome(2)?.outcome).toBe('skipped');
      expect(outcome(1)?.outcomeError).toMatchObject({
        code: 'VALIDATION_FAILED',
        issues: [expect.objectContaining({ column: 'parent', code: 'referenceFailed' })],
      });
    });

    it('修改模式：改上層就搬移；搬到自己的下層 → referenceCycle', async () => {
      const admin = await login(ADMIN);
      await importRows(admin, 'orgUnit', 'create', [
        { rowNo: 1, cells: { code: 'P1', name: 'P1' } },
        { rowNo: 2, cells: { code: 'P2', name: 'P2' } },
        { rowNo: 3, cells: { code: 'CH', name: 'CH', parent: 'P1' } },
      ]);
      const [cycle] = await validate(admin, 'orgUnit', 'update', [
        { rowNo: 1, cells: { code: 'P1', parent: 'CH' } },
      ]);
      expect(codesOf(cycle)).toEqual(['referenceCycle']);
      const { transfer } = await importRows(admin, 'orgUnit', 'update', [
        { rowNo: 1, cells: { code: 'CH', parent: 'P2' } },
      ]);
      expect(transfer.succeededRows).toBe(1);
      const [p2] = await db.select().from(orgUnits).where(eq(orgUnits.code, 'P2'));
      const [child] = await db.select().from(orgUnits).where(eq(orgUnits.code, 'CH'));
      expect(child?.parentId).toBe(p2?.id);
    });

    it('成員：新增、修改主要部門；不能改自己；同一批同一個人兩個主要部門', async () => {
      const admin = await login(ADMIN);
      const alice = await createActiveUser('org-alice@example.com', 'MemberPassword!2026', null);
      await importRows(admin, 'orgUnit', 'create', [
        { rowNo: 1, cells: { code: 'U1', name: 'U1' } },
        { rowNo: 2, cells: { code: 'U2', name: 'U2' } },
      ]);
      const issues = await validate(admin, 'orgUnitMember', 'create', [
        { rowNo: 1, cells: { unit: 'U1', user: ADMIN.email } },
        { rowNo: 2, cells: { unit: 'U1', user: alice.email, isPrimary: '是' } },
        { rowNo: 3, cells: { unit: 'U2', user: alice.email, isPrimary: '是' } },
      ]);
      expect(issues.map(codesOf)).toEqual([
        ['selfModify'],
        ['primaryConflict'],
        ['primaryConflict'],
      ]);

      const added = await importRows(admin, 'orgUnitMember', 'create', [
        { rowNo: 1, cells: { unit: 'U1', user: alice.email, isPrimary: '是', title: '專員' } },
        { rowNo: 2, cells: { unit: 'U2', user: alice.email, isManager: '是' } },
      ]);
      expect(added.transfer.succeededRows).toBe(2);
      const [u2] = await db.select().from(orgUnits).where(eq(orgUnits.code, 'U2'));
      const updated = await importRows(admin, 'orgUnitMember', 'update', [
        { rowNo: 1, cells: { id: `${u2!.id}:${alice.id}`, isPrimary: '是' } },
      ]);
      expect(updated.transfer.succeededRows).toBe(1);
      const memberships = await db
        .select()
        .from(orgUnitMembers)
        .where(eq(orgUnitMembers.userId, alice.id));
      // 設為主要部門時，原本的主要部門取消
      expect(memberships.find((row) => row.unitId === u2!.id)?.isPrimary).toBe(true);
      expect(memberships.filter((row) => row.isPrimary)).toHaveLength(1);

      const lines = await exportCsv(admin, 'orgUnitMember');
      expect(lines[0]).toBe('ID,部門,使用者,主管,主要部門,職稱,顯示名稱,部門路徑');
      expect(lines.slice(1)).toEqual([
        `${(await db.select().from(orgUnits).where(eq(orgUnits.code, 'U1')))[0]!.id}:${alice.id},U1,${alice.email},否,否,專員,${alice.email},U1`,
        `${u2!.id}:${alice.id},U2,${alice.email},是,是,,${alice.email},U2`,
      ]);
    });
  });

  describe('標籤（§13.4）', () => {
    it('依標籤組建立；組內撞名 → alreadyExists；匯出一個組', async () => {
      const admin = await login(ADMIN);
      await db.delete(tags);
      const { transfer } = await importRows(admin, 'tag', 'create', [
        { rowNo: 1, cells: { scope: '使用者', name: 'VIP', color: '紅' } },
        { rowNo: 2, cells: { scope: 'file', name: 'VIP' } },
      ]);
      expect(transfer.succeededRows).toBe(2);
      const [duplicate] = await validate(admin, 'tag', 'create', [
        { rowNo: 1, cells: { scope: 'user', name: 'vip' } },
      ]);
      expect(codesOf(duplicate)).toEqual(['alreadyExists']);
      const lines = await exportCsv(admin, 'tag', { scope: 'user' });
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain(',使用者,VIP,紅,');
    });
  });

  describe('只匯出（§13.5、§13.6）', () => {
    it('審批：請求與決定；單關的請求以請求上的審核者表示；不含 private_payload', async () => {
      const auditor = await login(AUDITOR);
      await db.insert(approvalRequests).values({
        type: 'user.register',
        status: 'approved',
        subjectKey: 'applicant@example.com',
        payload: { email: 'applicant@example.com' },
        privatePayload: { passwordHash: 'secret-hash' },
        requesterName: 'applicant@example.com',
        reviewerName: 'Reviewer',
        reviewComment: '核准',
        reviewedAt: new Date('2026-10-01T02:00:00Z'),
      });
      const requests = await exportCsv(auditor, 'approvalRequest');
      expect(requests[1]).toContain(',使用者註冊,已核准,applicant@example.com,');
      expect(requests.join('\n')).not.toContain('secret-hash');
      const decisions = await exportCsv(auditor, 'approvalDecision');
      expect(decisions[1]).toContain(
        ',使用者註冊,applicant@example.com,,,Reviewer,核准,單關審核,核准,',
      );
    });

    it('服務帳號：角色與有效的 token 數；auditor 沒有 serviceAccount:export', async () => {
      const admin = await login(ADMIN);
      await request(http)
        .post('/service-accounts')
        .set('authorization', `Bearer ${admin}`)
        .send({ name: 'CI bot' })
        .expect(201);
      const lines = await exportCsv(admin, 'serviceAccount');
      expect(lines[0]).toBe('ID,名稱,狀態,角色,有效的 token 數,建立時間');
      expect(lines[1]).toContain(',CI bot,啟用,,0,');
      await request(http)
        .post('/data-transfers/exports')
        .set('authorization', `Bearer ${await login(AUDITOR)}`)
        .send({ type: 'serviceAccount', scope: { kind: 'filter', filter: {} } })
        .expect(403);
    });
  });
});
