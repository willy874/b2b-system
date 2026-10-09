import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import type { PermissionKey } from '@/common/types';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { TENANT_FEATURES, TenantDirectory } from '@/core/tenant';
import type { TenantFeature } from '@/core/tenant';
import { tenants as platformTenants } from '@/db/platform/schema';
import {
  approvalRequests,
  approvalSteps,
  groupMemberTuple,
  groups,
  notifications,
  orgUnitMembers,
  orgUnits,
  relationTuples,
  roleHolderTuple,
  roles,
  users,
} from '@/db/schema';
import type { ApprovalType } from '@/modules/approval/approval.constants';
import { ApprovalService } from '@/modules/approval/approval.service';
import type { ApprovalHandler } from '@/modules/approval/approval.types';

import type { TestDatabase } from './db';
import { createPlatformTestDatabase, createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { inTestTenant, testTenantContext } from './tenant';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let closeDb: () => Promise<void>;

const PASSWORD = 'Chain-Password!2026';
// beforeAll 填入的 id；之後的測試都依賴它們
const ids = {} as Record<
  'admin' | 'carl' | 'amy' | 'f1' | 'f2' | 'ceo' | 'outsider' | 'finance' | 'north',
  string
>;
const tokenCache = new Map<string, string>();

/** 只存在於這個測試的審批類型：採購申請，依金額與類別分流（docs/architecture/backend/20-approval.md §9.1）。 */
const PURCHASE = 'test.purchase' as ApprovalType;
let requiredKeys: PermissionKey[] = [];
const handler = {
  type: PURCHASE,
  flow: {
    requester: 'user' as const,
    fields: [
      {
        key: 'amount',
        type: 'number' as const,
        read: (payload: Record<string, unknown>) =>
          typeof payload.amount === 'number' ? payload.amount : null,
      },
      {
        key: 'category',
        type: 'enum' as const,
        options: ['hardware', 'software'],
        read: (payload: Record<string, unknown>) =>
          typeof payload.category === 'string' ? payload.category : null,
      },
    ],
  },
  requiredPermissions: () => requiredKeys,
  assertApprovable: vi.fn(async () => undefined),
  apply: vi.fn(async () => ({ resourceId: 'purchase-order-1' })),
  afterApply: vi.fn(async () => undefined),
  summarize: (payload: Record<string, unknown>) => `採購 ${String(payload.amount)}`,
} satisfies ApprovalHandler;

function email(name: string): string {
  return `${name}@chain.example.com`;
}

async function login(name: string): Promise<string> {
  const cached = tokenCache.get(name);
  if (cached) return cached;
  const response = await request(http)
    .post('/auth/login')
    .send({ email: email(name), password: PASSWORD })
    .expect(200);
  const token = (response.body as { data: { accessToken: string } }).data.accessToken;
  tokenCache.set(name, token);
  return token;
}

async function as(name: string) {
  const token = await login(name);
  return {
    get: (path: string) => request(http).get(path).set('authorization', `Bearer ${token}`),
    post: (path: string, body?: object) =>
      request(http).post(path).set('authorization', `Bearer ${token}`).send(body),
    put: (path: string, body: object) =>
      request(http).put(path).set('authorization', `Bearer ${token}`).send(body),
  };
}

async function createUser(name: string, roleSlug?: string): Promise<string> {
  const { hashPassword } = await import('@/modules/credential/password');
  const [user] = await db
    .insert(users)
    .values({
      email: email(name),
      displayName: name,
      passwordHash: await hashPassword(PASSWORD),
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

let subjectSeq = 0;
/** 以申請人的身分送出一筆採購申請（業務模組的入口會這樣呼叫 `ApprovalService.submit`）。 */
async function submit(
  amount: number,
  requester: keyof typeof ids = 'carl',
  category = 'hardware',
): Promise<string> {
  subjectSeq += 1;
  const created = await inTestTenant(app, () =>
    app.get(ApprovalService).submit({
      type: PURCHASE,
      subjectKey: `purchase-${subjectSeq}`,
      payload: { amount, category },
      requester: { id: ids[requester as keyof typeof ids], name: email(requester) },
    }),
  );
  if (!created) throw new Error('沒有建立請求');
  return created.id;
}

async function detail(id: string, viewer = 'admin') {
  const response = await (await as(viewer)).get(`/approvals/${id}`).expect(200);
  return response.body.data as {
    status: string;
    currentStep: { ordinal: number; approvals: number; required: number } | null;
    steps: Array<{
      ordinal: number;
      name: string;
      status: string;
      shortage: string | null;
      closeReason: string | null;
      candidates: Array<{ userId: string }>;
      decisions: Array<{ reviewerId: string; decision: string; via: string }>;
    }>;
    viewer: {
      canDecide: boolean;
      canOverride: boolean;
      canReviewSingle: boolean;
      canWithdraw: boolean;
    };
  };
}

function candidatesOf(step: { candidates: Array<{ userId: string }> } | undefined): string[] {
  return (step?.candidates ?? []).map((candidate) => candidate.userId).toSorted();
}

let flowVersion: number | undefined;
async function putFlow(
  steps: object[],
  options: { allowRepeatApprover?: boolean; enabled?: boolean } = {},
) {
  const response = await (
    await as('admin')
  )
    .put(`/approval-flows/${PURCHASE}`, {
      enabled: options.enabled ?? true,
      allowRepeatApprover: options.allowRepeatApprover ?? false,
      steps,
      version: flowVersion,
    })
    .expect(200);
  flowVersion = response.body.data.flow.version;
  return response.body.data;
}

const STANDARD_FLOW = () => [
  {
    key: 'manager',
    name: '部門主管',
    assignee: { kind: 'manager', level: 1 },
    requiredApprovals: 1,
  },
  {
    key: 'finance',
    name: '財務',
    assignee: { kind: 'group', id: ids.finance },
    requiredApprovals: 2,
    conditions: [{ field: 'amount', op: 'gte', value: 50000 }],
  },
  {
    key: 'ceo',
    name: '總經理',
    assignee: { kind: 'user', id: ids.ceo },
    requiredApprovals: 1,
    conditions: [{ field: 'amount', op: 'gte', value: 500000 }],
  },
];

describe('多階段審批（docs/architecture/backend/20-approval.md §9）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = email('root');
    process.env.SUPER_ADMIN_PASSWORD = 'Quiet-Harbor-Lantern-26';
    process.env.PERMISSION_CACHE_TTL = '60';

    const created = createTestDatabase();
    db = created.db;
    closeDb = async () => created.client.end();
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);

    ids.admin = await createUser('admin', 'admin');
    ids.carl = await createUser('carl', 'member');
    ids.amy = await createUser('amy', 'member');
    ids.f1 = await createUser('f1', 'member');
    ids.f2 = await createUser('f2', 'member');
    ids.ceo = await createUser('ceo', 'member');
    ids.outsider = await createUser('outsider', 'member');

    const [finance] = await db.insert(groups).values({ name: '財務' }).returning();
    ids.finance = finance!.id;
    await db
      .insert(relationTuples)
      .values([
        groupMemberTuple(ids.finance, { type: 'user', id: ids.f1 }),
        groupMemberTuple(ids.finance, { type: 'user', id: ids.f2 }),
      ]);
    const [north] = await db.insert(orgUnits).values({ name: '北區' }).returning();
    ids.north = north!.id;
    await db.insert(orgUnitMembers).values([
      { unitId: ids.north, userId: ids.amy, isManager: true, isPrimary: true },
      { unitId: ids.north, userId: ids.carl, isPrimary: true },
    ]);

    const { AppModule } = await import('@/app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    http = await listenOnLoopback(app);
    app.get(ApprovalService).registerHandler(handler);
    await setTenantFeatures(TENANT_FEATURES);
  });

  afterAll(async () => {
    if (!app) return;
    await setTenantFeatures(TENANT_FEATURES);
    await app.close();
    await closeDb();
  });

  beforeEach(() => {
    requiredKeys = [];
    handler.apply.mockClear();
    handler.afterApply.mockClear();
  });

  describe('流程設定', () => {
    it('建立第一版；修改要帶 version，否則 409', async () => {
      const saved = await putFlow(STANDARD_FLOW());
      expect(saved.flow.steps).toHaveLength(3);
      expect(saved.flow.steps[1].assigneeStatus).toEqual({
        label: '財務',
        available: true,
        deleted: false,
      });
      const stale = await (
        await as('admin')
      )
        .put(`/approval-flows/${PURCHASE}`, { enabled: true, steps: STANDARD_FLOW() })
        .expect(409);
      expect(stale.body.error.code).toBe('APPROVAL_FLOW_VERSION_CONFLICT');
    });

    it('條件的欄位、運算子、值與 handler 的宣告不符 → VALIDATION_FAILED', async () => {
      const response = await (
        await as('admin')
      )
        .put(`/approval-flows/${PURCHASE}`, {
          enabled: true,
          version: flowVersion,
          steps: [
            {
              name: 'x',
              assignee: { kind: 'user', id: ids.ceo },
              requiredApprovals: 1,
              conditions: [
                { field: 'category', op: 'gt', value: 1 },
                { field: 'unknown', op: 'eq', value: 1 },
              ],
            },
          ],
        })
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(Object.keys(response.body.error.details.fields)).toEqual([
        'steps.0.conditions.0.op',
        'steps.0.conditions.1.field',
      ]);
    });

    it('不支援流程的類型 → 422；沒有 approvalFlow:update → 403', async () => {
      const unsupported = await (
        await as('admin')
      )
        .put('/approval-flows/fileFolder.access', { enabled: true, steps: STANDARD_FLOW() })
        .expect(422);
      expect(unsupported.body.error.code).toBe('APPROVAL_FLOW_NOT_SUPPORTED');
      await (await as('carl')).get('/approval-flows').expect(403);
    });

    it('反提權（D11）：操作者沒有該類型核准所需的權限 → 403', async () => {
      requiredKeys = ['system:update'];
      const response = await (
        await as('admin')
      )
        .put(`/approval-flows/${PURCHASE}`, {
          enabled: true,
          version: flowVersion,
          steps: STANDARD_FLOW(),
        })
        .expect(403);
      expect(response.body.error.details.missing).toEqual(['system:update']);
    });

    it('試算：80,000 → 主管、財務 2 人、總經理略過', async () => {
      const response = await (
        await as('admin')
      )
        .post(`/approval-flows/${PURCHASE}/preview`, {
          requesterId: ids.carl,
          fields: { amount: 80000 },
        })
        .expect(200);
      expect(
        response.body.data.steps.map((step: { skipped: boolean; required: number | null }) => [
          step.skipped,
          step.required,
        ]),
      ).toEqual([
        [false, 1],
        [false, 2],
        [true, null],
      ]);
      expect(candidatesOf(response.body.data.steps[0])).toEqual([ids.amy]);
      expect(candidatesOf(response.body.data.steps[1])).toEqual([ids.f1, ids.f2].toSorted());
    });
  });

  describe('依序多關、會簽', () => {
    it('80,000：主管 → 財務 2／2 → 定案；總經理略過；只執行一次 handler.apply', async () => {
      const id = await submit(80000);
      let state = await detail(id);
      expect(state.steps.map((step) => step.status)).toEqual(['active', 'waiting', 'skipped']);
      expect(candidatesOf(state.steps[0])).toEqual([ids.amy]);

      // 主管的待審通知連到「我的審批」
      const [notice] = await db
        .select()
        .from(notifications)
        .where(
          and(eq(notifications.recipientId, ids.amy), eq(notifications.type, 'approval.pending')),
        );
      expect(notice?.link).toEqual({ route: 'approval.myDetail', params: { approvalId: id } });

      // 待我審核：主管看得到；財務還看不到這一筆（不是候選人）
      const inbox = await (await as('amy')).get('/approvals?scope=assigned').expect(200);
      expect(inbox.body.data.items.map((item: { id: string }) => item.id)).toContain(id);
      await (await as('f1')).get(`/approvals/${id}`).expect(404);

      // 單關的端點不能用在進行中的多關請求
      const single = await (await as('admin')).post(`/approvals/${id}/approve`, {}).expect(409);
      expect(single.body.error.code).toBe('APPROVAL_CHAIN_IN_PROGRESS');

      await (
        await as('amy')
      )
        .post(`/approvals/${id}/steps/0/decisions`, { decision: 'approve' })
        .expect(200);
      state = await detail(id);
      expect(state.currentStep).toMatchObject({ ordinal: 1, approvals: 0, required: 2 });
      expect(candidatesOf(state.steps[1])).toEqual([ids.f1, ids.f2].toSorted());

      await (
        await as('f1')
      )
        .post(`/approvals/${id}/steps/1/decisions`, { decision: 'approve' })
        .expect(200);
      const again = await (
        await as('f1')
      )
        .post(`/approvals/${id}/steps/1/decisions`, { decision: 'approve' })
        .expect(409);
      expect(again.body.error.code).toBe('APPROVAL_STEP_ALREADY_DECIDED');
      const stale = await (
        await as('f2')
      )
        .post(`/approvals/${id}/steps/0/decisions`, { decision: 'approve' })
        .expect(409);
      expect(stale.body.error.code).toBe('APPROVAL_STEP_STALE');
      expect((await detail(id)).currentStep).toMatchObject({ approvals: 1, required: 2 });

      await (
        await as('f2')
      )
        .post(`/approvals/${id}/steps/1/decisions`, { decision: 'approve' })
        .expect(200);
      state = await detail(id);
      expect(state.status).toBe('approved');
      expect(state.steps.map((step) => step.status)).toEqual(['approved', 'approved', 'skipped']);
      expect(handler.apply).toHaveBeenCalledTimes(1);
      expect(handler.afterApply).toHaveBeenCalledTimes(1);
    });

    it('會簽的兩個人同時同意：只推進一次（D16）', async () => {
      const id = await submit(60000);
      await (
        await as('amy')
      )
        .post(`/approvals/${id}/steps/0/decisions`, { decision: 'approve' })
        .expect(200);
      const [f1, f2] = await Promise.all([as('f1'), as('f2')]);
      const results = await Promise.all([
        f1.post(`/approvals/${id}/steps/1/decisions`, { decision: 'approve' }),
        f2.post(`/approvals/${id}/steps/1/decisions`, { decision: 'approve' }),
      ]);
      expect(results.map((result) => result.status)).toEqual([200, 200]);
      expect((await detail(id)).status).toBe('approved');
      expect(handler.apply).toHaveBeenCalledTimes(1);
    });

    it('任一人駁回 → 整筆駁回，其餘關卡 cancelled', async () => {
      const id = await submit(70000);
      await (
        await as('amy')
      )
        .post(`/approvals/${id}/steps/0/decisions`, { decision: 'approve' })
        .expect(200);
      await (
        await as('f1')
      )
        .post(`/approvals/${id}/steps/1/decisions`, { decision: 'reject', comment: '預算不足' })
        .expect(200);
      const state = await detail(id);
      expect(state.status).toBe('rejected');
      expect(state.steps.map((step) => step.status)).toEqual(['approved', 'rejected', 'skipped']);
      expect(handler.apply).not.toHaveBeenCalled();
    });

    it('不是候選人 → 403 APPROVAL_NOT_ASSIGNED；申請人不能審自己的 → 403', async () => {
      const id = await submit(10000);
      const outsider = await (
        await as('outsider')
      )
        .post(`/approvals/${id}/steps/0/decisions`, { decision: 'approve' })
        .expect(403);
      expect(outsider.body.error.code).toBe('APPROVAL_NOT_ASSIGNED');
      const self = await (
        await as('carl')
      )
        .post(`/approvals/${id}/steps/0/decisions`, { decision: 'approve' })
        .expect(403);
      expect(self.body.error.code).toBe('APPROVAL_SELF_REVIEW');
    });

    it('最後一關只留下持有 handler 權限的人（D3）', async () => {
      requiredKeys = ['user:create'];
      const id = await submit(10000);
      const state = await detail(id);
      // 主管是最後一關（財務、總經理都略過）；Amy 沒有 user:create
      expect(state.steps[0]).toMatchObject({ status: 'active', shortage: 'noCandidate' });
      expect(candidatesOf(state.steps[0])).toEqual([]);
    });
  });

  describe('申請人', () => {
    it('「我的申請」與撤回；別人撤回 → 403', async () => {
      const id = await submit(20000);
      const mine = await (await as('carl')).get('/approvals?scope=mine').expect(200);
      expect(mine.body.data.items.map((item: { id: string }) => item.id)).toContain(id);
      const visible = await detail(id, 'carl');
      expect(visible.viewer.canWithdraw).toBe(true);
      // 沒有 approval:read 也不能看全部
      await (await as('carl')).get('/approvals').expect(403);

      const other = await (await as('amy')).post(`/approvals/${id}/withdraw`).expect(403);
      expect(other.body.error.code).toBe('APPROVAL_NOT_REQUESTER');
      await (await as('carl')).post(`/approvals/${id}/withdraw`).expect(200);
      const state = await detail(id);
      expect(state.status).toBe('withdrawn');
      expect(state.steps[0]?.closeReason).toBe('withdrawn');
    });
  });

  describe('互動與引導（docs/architecture/backend/20-approval.md §11）', () => {
    it('列表的目前關卡帶未決定的審核者、人數與開始時間；決定後扣掉', async () => {
      const id = await submit(80000);
      await (
        await as('amy')
      )
        .post(`/approvals/${id}/steps/0/decisions`, { decision: 'approve' })
        .expect(200);

      const pendingOf = async () => {
        const list = await (await as('admin')).get('/approvals?status=pending').expect(200);
        return list.body.data.items.find((item: { id: string }) => item.id === id).currentStep;
      };
      let current = await pendingOf();
      expect(current).toMatchObject({
        ordinal: 1,
        pendingReviewers: ['f1', 'f2'],
        pendingCount: 2,
      });
      expect(typeof current.activatedAt).toBe('string');

      await (
        await as('f1')
      )
        .post(`/approvals/${id}/steps/1/decisions`, { decision: 'approve' })
        .expect(200);
      current = await pendingOf();
      expect(current).toMatchObject({ pendingReviewers: ['f2'], pendingCount: 1 });
      await (await as('carl')).post(`/approvals/${id}/withdraw`).expect(200);
    });

    it('待審數：待我審核給候選人；全部的待審只給 approval:read', async () => {
      const id = await submit(20000);
      const amy = await (await as('amy')).get('/approvals/counts').expect(200);
      expect(amy.body.data.assigned).toBeGreaterThanOrEqual(1);
      expect(amy.body.data.pending).toBeNull();
      const admin = await (await as('admin')).get('/approvals/counts').expect(200);
      expect(admin.body.data.pending).toBeGreaterThanOrEqual(1);

      await (
        await as('amy')
      )
        .post(`/approvals/${id}/steps/0/decisions`, { decision: 'reject' })
        .expect(200);
      const after = await (await as('amy')).get('/approvals/counts').expect(200);
      expect(after.body.data.assigned).toBe(amy.body.data.assigned - 1);
    });

    it('重新送出：前一筆的詳情指向新的一筆；別人的請求不能當前一筆', async () => {
      const first = await submit(20000);
      await (await as('carl')).post(`/approvals/${first}/withdraw`).expect(200);

      subjectSeq += 1;
      const resubmit = (requester: 'carl' | 'amy') =>
        inTestTenant(app, () =>
          app.get(ApprovalService).submit({
            type: PURCHASE,
            subjectKey: `purchase-${subjectSeq}`,
            payload: { amount: 20000, category: 'hardware' },
            requester: { id: ids[requester], name: email(requester) },
            resubmittedFrom: first,
          }),
        );
      await expect(resubmit('amy')).rejects.toMatchObject({ code: 'APPROVAL_RESUBMIT_INVALID' });
      const second = await resubmit('carl');

      const previous = await (await as('carl')).get(`/approvals/${first}`).expect(200);
      expect(previous.body.data.resubmittedTo).toBe(second?.id);
      expect(second?.resubmittedFrom).toBe(first);
      await (await as('carl')).post(`/approvals/${second?.id}/withdraw`).expect(200);
    });

    it('留言：看得到請求的人可以留言（定案後也可以），看不到的人 404', async () => {
      const id = await submit(20000);
      await (await as('carl')).post(`/comments/approval/${id}`, { body: '請盡快' }).expect(201);
      await (await as('amy')).get(`/comments/approval/${id}`).expect(200);
      const outsider = await (await as('outsider')).get(`/comments/approval/${id}`).expect(404);
      expect(outsider.body.error.code).toBe('APPROVAL_NOT_FOUND');

      await (
        await as('amy')
      )
        .post(`/approvals/${id}/steps/0/decisions`, { decision: 'reject' })
        .expect(200);
      await (await as('carl')).post(`/comments/approval/${id}`, { body: '為什麼？' }).expect(201);
      const list = await (await as('admin')).get(`/comments/approval/${id}`).expect(200);
      expect(list.body.data.items).toHaveLength(2);
    });
  });

  describe('同一個人審兩關（D6）', () => {
    it('預設不行：前面關卡做過決定的人不是後面關卡的候選人', async () => {
      // Amy 同時是財務
      await db
        .insert(relationTuples)
        .values(groupMemberTuple(ids.finance, { type: 'user', id: ids.amy }));
      try {
        const id = await submit(90000);
        await (
          await as('amy')
        )
          .post(`/approvals/${id}/steps/0/decisions`, { decision: 'approve' })
          .expect(200);
        const state = await detail(id);
        expect(candidatesOf(state.steps[1])).toEqual([ids.f1, ids.f2].toSorted());
      } finally {
        await db
          .delete(relationTuples)
          .where(
            and(eq(relationTuples.objectId, ids.finance), eq(relationTuples.subjectId, ids.amy)),
          );
      }
    });
  });

  describe('短缺與 override（D9、D10）', () => {
    it('沒有候選人 → noCandidate、通知 override 持有者；refresh 只增不減；override 強制定案', async () => {
      const [empty] = await db.insert(groups).values({ name: '空的審核群組' }).returning();
      onTestFinished(() => putFlow(STANDARD_FLOW()).then(() => undefined));
      await putFlow([
        {
          key: 'empty',
          name: '空關卡',
          assignee: { kind: 'group', id: empty!.id },
          requiredApprovals: 1,
        },
        {
          key: 'manager',
          name: '部門主管',
          assignee: { kind: 'manager', level: 1 },
          requiredApprovals: 1,
        },
      ]);
      const unassigned = () =>
        db
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.recipientId, ids.admin),
              eq(notifications.type, 'approval.unassigned'),
            ),
          );
      const before = (await unassigned()).length;
      const id = await submit(1000);
      let state = await detail(id);
      expect(state.steps[0]).toMatchObject({ status: 'active', shortage: 'noCandidate' });
      expect(state.viewer.canOverride).toBe(true);
      expect((await unassigned()).length).toBe(before + 1);

      await db
        .insert(relationTuples)
        .values(groupMemberTuple(empty!.id, { type: 'user', id: ids.f1 }));
      await (await as('admin')).post(`/approvals/${id}/steps/0/refresh`).expect(200);
      state = await detail(id);
      expect(state.steps[0]?.shortage).toBeNull();
      expect(candidatesOf(state.steps[0])).toEqual([ids.f1]);

      const noComment = await (
        await as('admin')
      )
        .post(`/approvals/${id}/steps/0/override`, { decision: 'approve', comment: '' })
        .expect(400);
      expect(noComment.body.error.code).toBe('VALIDATION_FAILED');
      await (
        await as('admin')
      )
        .post(`/approvals/${id}/steps/0/override`, {
          decision: 'approve',
          comment: '群組設定錯誤，先放行',
        })
        .expect(200);
      state = await detail(id);
      expect(state.steps[0]).toMatchObject({ status: 'approved', closeReason: 'override' });
      expect(state.steps[0]?.decisions[0]).toMatchObject({
        reviewerId: ids.admin,
        via: 'override',
      });
      expect(state.currentStep?.ordinal).toBe(1);
    });

    it('流程裡新增指到已刪除群組的關卡 → 422 APPROVAL_FLOW_ASSIGNEE_UNAVAILABLE', async () => {
      const [gone] = await db
        .insert(groups)
        .values({ name: '已刪除', deletedAt: new Date() })
        .returning();
      const response = await (
        await as('admin')
      )
        .put(`/approval-flows/${PURCHASE}`, {
          enabled: true,
          version: flowVersion,
          steps: [
            ...STANDARD_FLOW(),
            { name: '新關卡', assignee: { kind: 'group', id: gone!.id }, requiredApprovals: 1 },
          ],
        })
        .expect(422);
      expect(response.body.error.details.steps).toEqual([3]);
    });
  });

  describe('平台關閉（D12～D14）', () => {
    it('approvalChain 停用：新申請單關；進行中的以單關端點一次定案；重新啟用後未定案的從原關卡繼續', async () => {
      const inFlight = await submit(80000);
      const resumable = await submit(80000);
      await setTenantFeatures(TENANT_FEATURES.filter((feature) => feature !== 'approvalChain'));
      try {
        const single = await submit(80000);
        const [row] = await db
          .select()
          .from(approvalRequests)
          .where(eq(approvalRequests.id, single));
        expect(row).toMatchObject({ flowId: null, currentStep: null });

        const step = await (
          await as('amy')
        )
          .post(`/approvals/${inFlight}/steps/0/decisions`, { decision: 'approve' })
          .expect(404);
        expect(step.body.error.code).toBe('FEATURE_DISABLED');
        await (await as('admin')).get('/approval-flows').expect(404);
        const inbox = await (await as('amy')).get('/approvals?scope=assigned').expect(200);
        expect(inbox.body.data.items).toEqual([]);

        await (
          await as('admin')
        )
          .post(`/approvals/${inFlight}/approve`, { comment: '降級後定案' })
          .expect(200);
        const state = await detail(inFlight);
        expect(state.status).toBe('approved');
        expect(state.steps.map((s) => [s.status, s.closeReason])).toEqual([
          ['cancelled', 'chainDisabled'],
          ['cancelled', 'chainDisabled'],
          ['skipped', null],
        ]);
        expect(state.steps[0]?.decisions[0]).toMatchObject({ via: 'legacy' });
      } finally {
        await setTenantFeatures(TENANT_FEATURES);
      }
      await (
        await as('amy')
      )
        .post(`/approvals/${resumable}/steps/0/decisions`, { decision: 'approve' })
        .expect(200);
      expect((await detail(resumable)).currentStep?.ordinal).toBe(1);
    });

    it('organization 停用：主管規則展開為空 → noCandidate；新增主管規則的關卡 422', async () => {
      await setTenantFeatures(TENANT_FEATURES.filter((feature) => feature !== 'organization'));
      try {
        const id = await submit(1000);
        const state = await detail(id);
        expect(state.steps[0]).toMatchObject({ status: 'active', shortage: 'noCandidate' });

        const flows = await (await as('admin')).get('/approval-flows').expect(200);
        expect(flows.body.data.assigneeKinds).toMatchObject({ manager: false, orgUnit: false });
        const added = await (
          await as('admin')
        )
          .put(`/approval-flows/${PURCHASE}`, {
            enabled: true,
            version: flowVersion,
            steps: [
              ...STANDARD_FLOW(),
              { name: '二階主管', assignee: { kind: 'manager', level: 2 }, requiredApprovals: 1 },
            ],
          })
          .expect(422);
        expect(added.body.error.code).toBe('APPROVAL_FLOW_ASSIGNEE_UNAVAILABLE');
        // 沒改到主管那一關：照樣可以儲存（例：停用流程）
        await putFlow(STANDARD_FLOW(), { enabled: false });
        await putFlow(STANDARD_FLOW(), { enabled: true });
      } finally {
        await setTenantFeatures(TENANT_FEATURES);
      }
    });

    it('group 停用：群組規則展開為空', async () => {
      const id = await submit(80000);
      await (await as('amy')).post(`/approvals/${id}/steps/0/decisions`, { decision: 'approve' });
      const [step] = await db
        .select()
        .from(approvalSteps)
        .where(and(eq(approvalSteps.requestId, id), eq(approvalSteps.ordinal, 1)));
      expect(step?.shortage).toBeNull();

      await setTenantFeatures(TENANT_FEATURES.filter((feature) => feature !== 'group'));
      try {
        const another = await submit(80000);
        await (
          await as('amy')
        )
          .post(`/approvals/${another}/steps/0/decisions`, { decision: 'approve' })
          .expect(200);
        const state = await detail(another);
        expect(state.steps[1]).toMatchObject({ status: 'active', shortage: 'noCandidate' });
      } finally {
        await setTenantFeatures(TENANT_FEATURES);
      }
    });
  });
});
