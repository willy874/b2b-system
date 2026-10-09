import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DomainEvent, DomainEventBus } from '@/core/events';
import { TENANT_FEATURES, TenantDirectory } from '@/core/tenant';
import type { TenantFeature } from '@/core/tenant';
import { tenants as platformTenants } from '@/db/platform/schema';
import {
  orgUnitMembers,
  orgUnits,
  relationTuples,
  roleHolderTuple,
  roles,
  users,
} from '@/db/schema';
import { OrgChartService } from '@/modules/organization/org-chart.service';

import type { TestDatabase } from './db';
import { createPlatformTestDatabase, createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { inTestTenant, testTenantContext } from './tenant';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;

const ADMIN = { email: 'org-admin@example.com', password: 'AdminPassword!2026' };
const AUDITOR = { email: 'org-auditor@example.com', password: 'AuditorPassword!2026' };

// beforeAll 與前面的測試填入的 id；之後的測試依序依賴它們
const ids = {} as Record<
  'admin' | 'auditor' | 'amy' | 'ben' | 'carl' | 'dora' | 'sales' | 'north' | 'rd' | 'rdNorth',
  string
>;
const tokenCache = new Map<string, string>();

async function login(credentials: { email: string; password: string }): Promise<string> {
  const cached = tokenCache.get(credentials.email);
  if (cached) return cached;
  const response = await request(http).post('/auth/login').send(credentials).expect(200);
  const token = (response.body as { data: { accessToken: string } }).data.accessToken;
  tokenCache.set(credentials.email, token);
  return token;
}

async function as(credentials: { email: string; password: string }) {
  const token = await login(credentials);
  return {
    get: (path: string) => request(http).get(path).set('authorization', `Bearer ${token}`),
    post: (path: string, body?: object) =>
      request(http).post(path).set('authorization', `Bearer ${token}`).send(body),
    patch: (path: string, body: object) =>
      request(http).patch(path).set('authorization', `Bearer ${token}`).send(body),
    delete: (path: string) => request(http).delete(path).set('authorization', `Bearer ${token}`),
  };
}

async function createUser(email: string, password: string | null, roleSlug?: string) {
  const { hashPassword } = await import('@/modules/credential/password');
  const [user] = await db
    .insert(users)
    .values({
      email,
      displayName: email.split('@')[0] ?? email,
      passwordHash: password ? await hashPassword(password) : null,
      status: 'active',
    })
    .returning();
  if (roleSlug) {
    const [role] = await db.select().from(roles).where(eq(roles.slug, roleSlug));
    await db.insert(relationTuples).values(roleHolderTuple(role!.id, user!.id));
  }
  return user!.id;
}

async function setTenantFeatures(features: readonly TenantFeature[]): Promise<void> {
  const { id } = await testTenantContext(app);
  const platform = createPlatformTestDatabase();
  try {
    await platform.db
      .update(platformTenants)
      .set({ features: [...features] })
      .where(eq(platformTenants.id, id));
  } finally {
    await platform.client.end();
  }
  app.get(TenantDirectory).invalidate();
  app.get(DomainEventBus).publish(DomainEvent.TENANT_FEATURES_CHANGED, { tenantId: id });
}

function managersOf(userId: string, level: number) {
  return inTestTenant(app, () => app.get(OrgChartService).managersOf(userId, level));
}

async function createUnit(name: string, parentId: string | null = null, code?: string) {
  const admin = await as(ADMIN);
  const response = await admin.post('/org-units', { name, parentId, code }).expect(201);
  return (response.body as { data: { id: string; version: number } }).data;
}

describe('組織管理（docs/architecture/backend/23-organization.md）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = 'org-root@example.com';
    process.env.SUPER_ADMIN_PASSWORD = 'Quiet-Harbor-Lantern-26';
    process.env.PERMISSION_CACHE_TTL = '60';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    ids.admin = await createUser(ADMIN.email, ADMIN.password, 'admin');
    ids.auditor = await createUser(AUDITOR.email, AUDITOR.password, 'auditor');
    ids.amy = await createUser('amy@example.com', null);
    ids.ben = await createUser('ben@example.com', null);
    ids.carl = await createUser('carl@example.com', null);
    ids.dora = await createUser('dora@example.com', null);

    const { AppModule } = await import('@/app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    http = await listenOnLoopback(app);
    await setTenantFeatures(TENANT_FEATURES);
  });

  afterAll(async () => {
    if (!app) return;
    await setTenantFeatures(TENANT_FEATURES);
    await app.close();
    await closeDb();
  });

  it('建立部門樹；同一個上層之下名稱不分大小寫唯一，不同上層可以同名；代碼唯一', async () => {
    const admin = await as(ADMIN);
    ids.sales = (await createUnit('業務部', null, 'SALES')).id;
    ids.north = (await createUnit('北區', ids.sales)).id;
    ids.rd = (await createUnit('研發部')).id;
    ids.rdNorth = (await createUnit('北區', ids.rd)).id;

    const duplicate = await admin
      .post('/org-units', { name: '北區', parentId: ids.sales })
      .expect(409);
    expect(duplicate.body.error.code).toBe('ORG_UNIT_NAME_DUPLICATE');
    const code = await admin.post('/org-units', { name: '行銷部', code: 'sales' }).expect(409);
    expect(code.body.error.code).toBe('ORG_UNIT_CODE_DUPLICATE');

    const tree = await admin.get('/org-units').expect(200);
    expect(tree.body.data.items.map((unit: { name: string }) => unit.name).toSorted()).toEqual(
      ['北區', '北區', '研發部', '業務部'].toSorted(),
    );
    const detail = await admin.get(`/org-units/${ids.north}`).expect(200);
    expect(detail.body.data.path).toEqual([{ id: ids.sales, name: '業務部' }]);
  });

  it('關鍵字只回符合的部門與它們的上層', async () => {
    const admin = await as(ADMIN);
    const found = await admin.get('/org-units?keyword=北').expect(200);
    const names = found.body.data.items.map((unit: { id: string }) => unit.id).toSorted();
    expect(names).toEqual([ids.sales, ids.north, ids.rd, ids.rdNorth].toSorted());
    const sales = await admin.get('/org-units?keyword=SALES').expect(200);
    expect(sales.body.data.items.map((unit: { id: string }) => unit.id)).toEqual([ids.sales]);
  });

  it('搬移：搬到自己的下層 409 ORG_UNIT_CYCLE；搬到同名的上層之下 409；樂觀鎖', async () => {
    const admin = await as(ADMIN);
    const sales = await admin.get(`/org-units/${ids.sales}`).expect(200);
    const cycle = await admin
      .post(`/org-units/${ids.sales}/move`, {
        parentId: ids.north,
        version: sales.body.data.version,
      })
      .expect(409);
    expect(cycle.body.error.code).toBe('ORG_UNIT_CYCLE');

    const rdNorth = await admin.get(`/org-units/${ids.rdNorth}`).expect(200);
    const clash = await admin
      .post(`/org-units/${ids.rdNorth}/move`, {
        parentId: ids.sales,
        version: rdNorth.body.data.version,
      })
      .expect(409);
    expect(clash.body.error.code).toBe('ORG_UNIT_NAME_DUPLICATE');

    const stale = await admin
      .post(`/org-units/${ids.rdNorth}/move`, { parentId: null, version: 99 })
      .expect(409);
    expect(stale.body.error.code).toBe('ORG_UNIT_VERSION_CONFLICT');

    // 成功的搬移：同層的排序重新編排（sort_order 是 integer）
    const moved = await admin
      .post(`/org-units/${ids.rdNorth}/move`, {
        parentId: null,
        version: rdNorth.body.data.version,
      })
      .expect(200);
    expect(moved.body.data.parentId).toBeNull();
    await admin
      .post(`/org-units/${ids.rdNorth}/move`, {
        parentId: rdNorth.body.data.parentId,
        version: moved.body.data.version,
      })
      .expect(200);
  });

  it('層數上限：第 11 層 409 ORG_UNIT_TOO_DEEP', async () => {
    const admin = await as(ADMIN);
    let parent: string | null = null;
    for (let depth = 1; depth <= 10; depth += 1) {
      // oxlint-disable-next-line no-await-in-loop -- 依序往下建
      parent = (await createUnit(`層${depth}`, parent)).id;
    }
    const tooDeep = await admin.post('/org-units', { name: '層11', parentId: parent }).expect(409);
    expect(tooDeep.body.error.code).toBe('ORG_UNIT_TOO_DEEP');
  });

  it('成員：設為主要部門會取消原本的；不能改自己 403 AUTHZ_SELF_MODIFY', async () => {
    const admin = await as(ADMIN);
    await admin
      .patch(`/org-units/${ids.sales}/members`, {
        add: [
          { userId: ids.ben, isManager: true, isPrimary: true },
          { userId: ids.carl, isPrimary: true },
        ],
      })
      .expect(200);
    await admin
      .patch(`/org-units/${ids.north}/members`, {
        add: [
          { userId: ids.amy, isManager: true, isPrimary: true, title: '北區經理' },
          { userId: ids.carl, isPrimary: true },
          { userId: ids.dora, isPrimary: true },
        ],
      })
      .expect(200);
    const carl = await db.select().from(orgUnitMembers).where(eq(orgUnitMembers.userId, ids.carl));
    expect(carl.filter((row) => row.isPrimary).map((row) => row.unitId)).toEqual([ids.north]);

    const self = await admin
      .patch(`/org-units/${ids.north}/members`, { add: [{ userId: ids.admin }] })
      .expect(403);
    expect(self.body.error.code).toBe('AUTHZ_SELF_MODIFY');

    const units = await admin.get(`/users/${ids.carl}/org-units`).expect(200);
    expect(units.body.data.items[0]).toMatchObject({
      unitId: ids.north,
      isPrimary: true,
      path: [{ id: ids.sales, name: '業務部' }],
    });
  });

  it('成員：只帶 userId 加入 → 預設不是主管、不是主要部門；已是成員時不變（畫面的「加入」）', async () => {
    const admin = await as(ADMIN);
    await admin
      .patch(`/org-units/${ids.sales}/members`, { add: [{ userId: ids.amy }] })
      .expect(200);
    const row = async () =>
      (
        await db
          .select()
          .from(orgUnitMembers)
          .where(and(eq(orgUnitMembers.unitId, ids.sales), eq(orgUnitMembers.userId, ids.amy)))
      )[0];
    expect(await row()).toMatchObject({ isManager: false, isPrimary: false, title: null });

    // 已是成員（ben 是業務部的主管）：只帶 userId 等於沒有要改的欄位
    await admin
      .patch(`/org-units/${ids.sales}/members`, { add: [{ userId: ids.ben }] })
      .expect(200);
    const ben = await db
      .select()
      .from(orgUnitMembers)
      .where(and(eq(orgUnitMembers.unitId, ids.sales), eq(orgUnitMembers.userId, ids.ben)));
    expect(ben[0]).toMatchObject({ isManager: true, isPrimary: true });

    await admin.patch(`/org-units/${ids.sales}/members`, { remove: [ids.amy] }).expect(200);
  });

  it('主管的解析：沿主要部門往上、跳過自己（D5）', async () => {
    expect(await managersOf(ids.carl, 1)).toEqual([ids.amy]);
    expect(await managersOf(ids.carl, 2)).toEqual([ids.ben]);
    // 樹的每個部門帶主管的名字（組織圖用）
    const tree = await (await as(ADMIN)).get('/org-units').expect(200);
    const north = tree.body.data.items.find((unit: { id: string }) => unit.id === ids.north);
    expect(north.managers).toEqual([{ userId: ids.amy, displayName: 'amy' }]);
    expect(await managersOf(ids.carl, 3)).toEqual([]);
    // 主管本人：第 1 層是上層部門的主管
    expect(await managersOf(ids.amy, 1)).toEqual([ids.ben]);
    // 同一個部門有兩位主管時，彼此可以互審
    await (
      await as(ADMIN)
    )
      .patch(`/org-units/${ids.north}/members`, { update: [{ userId: ids.dora, isManager: true }] })
      .expect(200);
    expect(await managersOf(ids.amy, 1)).toEqual([ids.dora]);
    expect((await managersOf(ids.carl, 1)).toSorted()).toEqual([ids.amy, ids.dora].toSorted());
    // 停用的主管被略過
    await db.update(users).set({ status: 'inactive' }).where(eq(users.id, ids.dora));
    expect(await managersOf(ids.carl, 1)).toEqual([ids.amy]);
    await db.update(users).set({ status: 'active' }).where(eq(users.id, ids.dora));
  });

  it('使用者列表依部門篩選，可含下層部門', async () => {
    const admin = await as(ADMIN);
    const direct = await admin.get(`/users?orgUnitId=${ids.sales}`).expect(200);
    expect(direct.body.data.items.map((user: { id: string }) => user.id).toSorted()).toEqual(
      [ids.ben, ids.carl].toSorted(),
    );
    const all = await admin
      .get(`/users?orgUnitId=${ids.sales}&includeDescendants=true&limit=50`)
      .expect(200);
    expect(all.body.data.items.map((user: { id: string }) => user.id).toSorted()).toEqual(
      [ids.amy, ids.ben, ids.carl, ids.dora].toSorted(),
    );
  });

  it('刪除：還有下層 409；刪掉後進回收桶，上層被刪時不能還原，也不能建立或搬到它之下', async () => {
    const admin = await as(ADMIN);
    const hasChildren = await admin.delete(`/org-units/${ids.sales}`).expect(409);
    expect(hasChildren.body.error.code).toBe('ORG_UNIT_HAS_CHILDREN');

    const leaf = await createUnit('臨時小組', ids.rd);
    await admin.delete(`/org-units/${leaf.id}`).expect(204);
    const trash = await admin.get('/trash?type=orgUnit').expect(200);
    expect(trash.body.data.items.map((item: { id: string }) => item.id)).toContain(leaf.id);

    await admin.delete(`/org-units/${ids.rdNorth}`).expect(204);
    await admin.delete(`/org-units/${ids.rd}`).expect(204);
    // 上層已刪除的部門不會出現：結構的寫入在鎖之下檢查上層（docs/architecture/backend/23-organization.md §2）
    const createUnder = await admin
      .post('/org-units', { name: '孤兒', parentId: ids.rd })
      .expect(404);
    expect(createUnder.body.error.code).toBe('ORG_UNIT_NOT_FOUND');
    const moved = await createUnit('待搬移');
    const moveUnder = await admin
      .post(`/org-units/${moved.id}/move`, { parentId: ids.rd, version: moved.version })
      .expect(404);
    expect(moveUnder.body.error.code).toBe('ORG_UNIT_NOT_FOUND');
    await admin.delete(`/org-units/${moved.id}`).expect(204);
    const orphan = await admin.post(`/org-units/${ids.rdNorth}/restore`).expect(409);
    expect(orphan.body.error.code).toBe('ORG_UNIT_PARENT_DELETED');
    await admin.post(`/org-units/${ids.rd}/restore`).expect(200);
    await admin.post(`/org-units/${ids.rdNorth}/restore`).expect(200);
    const [row] = await db.select().from(orgUnits).where(eq(orgUnits.id, ids.rdNorth));
    expect(row?.deletedAt).toBeNull();
  });

  it('auditor 只能看，不能改', async () => {
    const auditor = await as(AUDITOR);
    await auditor.get('/org-units').expect(200);
    await auditor.post('/org-units', { name: '不行' }).expect(403);
  });

  it('organization 停用：端點 404、主管解析為空、使用者的部門篩選 400；資料保留，重新啟用後一致（D2）', async () => {
    const admin = await as(ADMIN);
    await setTenantFeatures(TENANT_FEATURES.filter((feature) => feature !== 'organization'));
    try {
      const off = await admin.get('/org-units').expect(404);
      expect(off.body.error.code).toBe('FEATURE_DISABLED');
      await admin.get(`/users/${ids.carl}/org-units`).expect(404);
      expect(await managersOf(ids.carl, 1)).toEqual([]);
      const filter = await admin.get(`/users?orgUnitId=${ids.sales}`).expect(400);
      expect(filter.body.error.code).toBe('VALIDATION_FAILED');
    } finally {
      await setTenantFeatures(TENANT_FEATURES);
    }
    expect((await managersOf(ids.carl, 1)).toSorted()).toEqual([ids.amy, ids.dora].toSorted());
  });
});
