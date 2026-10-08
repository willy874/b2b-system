import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import { AppException } from '@/core/errors';
import type { MfaPolicyRow } from '@/db/schema';

import type { MfaPolicyState } from '../mfa-availability.service';
import { DEFAULT_MFA_POLICY } from '../mfa-availability.service';
import { MfaPolicyService } from '../mfa-policy.service';
import { method, registryOf } from './mfa.fixture';

const ACTOR: AuthUser = { id: 'admin-1', email: 'admin@example.com', status: 'active' };
const UPDATED_AT = new Date('2026-10-08T01:02:03.000Z');

function setup(
  options: {
    row?: (MfaPolicyState & { updatedAt: Date }) | undefined;
    current?: MfaPolicyState;
    platformEnabled?: string[];
    existingRoles?: string[];
    candidates?: string[];
    requiredUsers?: string[];
  } = {},
) {
  const totp = method('totp');
  const email = method('email', { challenge: 'server' });
  const webauthn = method('webauthn', { realms: ['platform'] });
  const registry = registryOf(totp, email, webauthn);
  const byId = new Map([totp, email].map((m) => [m.definition.id, m]));
  const repo = {
    find: vi.fn(async () => options.row as MfaPolicyRow | undefined),
    existingRoleIds: vi.fn(async () => new Set(options.existingRoles ?? [])),
    save: vi.fn(async () => true),
  };
  const availability = {
    policy: vi.fn(async () => options.current ?? DEFAULT_MFA_POLICY),
    platformEnabled: vi.fn(() =>
      (options.platformEnabled ?? ['totp', 'email']).map((id) => byId.get(id)!),
    ),
    isRequiredBy: vi.fn(async (_policy: unknown, userId: string) =>
      (options.requiredUsers ?? []).includes(userId),
    ),
  };
  const factors = {
    countStranded: vi.fn(async () => 4),
    listActiveUserIdsWithoutMfa: vi.fn(async () => options.candidates ?? []),
  };
  const users = { assertRolesExist: vi.fn(async () => undefined) };
  const audit = { record: vi.fn(async () => undefined) };
  const service = new MfaPolicyService(
    repo as never,
    availability as never,
    factors as never,
    registry,
    users as never,
    audit as never,
  );
  return { service, repo, availability, factors, users, audit };
}

async function rejection(promise: Promise<unknown>): Promise<AppException> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  return error as AppException;
}

describe('MfaPolicyService（docs/architecture/backend/21-mfa.md §6、D7、D11）', () => {
  describe('get', () => {
    it('沒有列時回傳預設政策，updatedAt 為 null，列出能給租戶用的方式與平台是否開放', async () => {
      const { service, factors } = setup({ platformEnabled: ['totp'] });
      expect(await service.get()).toEqual({
        requireAll: false,
        requiredRoleIds: [],
        allowedMethods: null,
        version: 1,
        updatedAt: null,
        methods: [
          expect.objectContaining({ id: 'totp', platformEnabled: true }),
          expect.objectContaining({ id: 'email', platformEnabled: false }),
        ],
        nonCompliant: 0,
      });
      expect(factors.listActiveUserIdsWithoutMfa).not.toHaveBeenCalled();
    });

    it('有列時回傳它的值與 updatedAt；已刪除的角色濾掉', async () => {
      const { service, availability } = setup({
        row: {
          requireAll: false,
          requiredRoleIds: ['role-a', 'role-deleted'],
          allowedMethods: ['totp'],
          version: 3,
          updatedAt: UPDATED_AT,
        },
        existingRoles: ['role-a'],
        candidates: ['u1', 'u2', 'u3'],
        requiredUsers: ['u1', 'u3'],
      });
      const result = await service.get();
      expect(result).toMatchObject({
        requiredRoleIds: ['role-a'],
        allowedMethods: ['totp'],
        version: 3,
        updatedAt: UPDATED_AT.toISOString(),
        nonCompliant: 2,
      });
      expect(availability.policy).not.toHaveBeenCalled();
      expect(availability.isRequiredBy).toHaveBeenCalledWith(
        expect.objectContaining({ requiredRoleIds: ['role-a'] }),
        'u2',
      );
    });

    it('全員必須時，不符合的人數就是還沒設定的人數（不逐人判斷角色）', async () => {
      const { service, availability } = setup({
        current: { ...DEFAULT_MFA_POLICY, requireAll: true },
        candidates: ['u1', 'u2'],
      });
      expect((await service.get()).nonCompliant).toBe(2);
      expect(availability.isRequiredBy).not.toHaveBeenCalled();
    });
  });

  describe('preview', () => {
    it('允許全部（null）：stranded 以平台開放的全部方式計算', async () => {
      const { service, factors } = setup({ candidates: ['u1'] });
      const result = await service.preview({
        requireAll: true,
        requiredRoleIds: [],
        allowedMethods: null,
        version: 1,
      });
      expect(result).toEqual({ nonCompliant: 1, stranded: 4 });
      expect(factors.countStranded).toHaveBeenCalledWith(['totp', 'email']);
    });

    it('允許清單去重、依註冊表的順序，並與平台開放取交集', async () => {
      const { service, factors } = setup({ platformEnabled: ['totp'] });
      await service.preview({
        requireAll: false,
        requiredRoleIds: [],
        allowedMethods: ['email', 'totp', 'email'],
        version: 1,
      });
      expect(factors.countStranded).toHaveBeenCalledWith(['totp']);
    });

    it.each([
      ['不存在的方式', ['totp', 'sms']],
      ['只能給平台管理者用的方式', ['webauthn']],
    ])('允許清單有%s → VALIDATION_FAILED（MFA_METHOD_NOT_FOUND）', async (_label, allowed) => {
      const { service } = setup();
      const error = await rejection(
        service.preview({
          requireAll: false,
          requiredRoleIds: [],
          allowedMethods: allowed,
          version: 1,
        }),
      );
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details).toEqual({
        fields: { allowedMethods: 'MFA_METHOD_NOT_FOUND' },
        methods: allowed.filter((id) => id !== 'totp'),
      });
    });

    it('允許清單是空陣列 → VALIDATION_FAILED（MFA_POLICY_NO_METHOD）', async () => {
      const { service } = setup();
      const error = await rejection(
        service.preview({ requireAll: false, requiredRoleIds: [], allowedMethods: [], version: 1 }),
      );
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details).toEqual({ fields: { allowedMethods: 'MFA_POLICY_NO_METHOD' } });
    });
  });

  describe('update', () => {
    it('角色去重後檢查存在、存檔、寫 severity: high 的稽核（含變更前後），回傳新的政策', async () => {
      const before: MfaPolicyState = {
        requireAll: false,
        requiredRoleIds: ['role-old'],
        allowedMethods: null,
        version: 2,
      };
      const { service, users, repo, audit } = setup({ current: before });
      const result = await service.update(
        {
          requireAll: false,
          requiredRoleIds: ['role-a', 'role-a'],
          allowedMethods: ['totp'],
          version: 2,
        },
        ACTOR,
      );
      const after = { requireAll: false, requiredRoleIds: ['role-a'], allowedMethods: ['totp'] };
      expect(users.assertRolesExist).toHaveBeenCalledWith(['role-a']);
      expect(repo.save).toHaveBeenCalledWith(after, 2, ACTOR.id);
      expect(audit.record).toHaveBeenCalledWith({
        action: 'mfaPolicy.update',
        resourceType: 'mfaPolicy',
        resourceId: 'default',
        actorId: ACTOR.id,
        actorEmail: ACTOR.email,
        metadata: {
          severity: 'high',
          before: { requireAll: false, requiredRoleIds: ['role-old'], allowedMethods: null },
          after,
        },
      });
      expect(result.version).toBe(2);
    });

    it.each([
      ['全員必須', { requireAll: true, requiredRoleIds: [] }],
      ['指定角色必須', { requireAll: false, requiredRoleIds: ['role-a'] }],
    ])(
      '%s但允許的方式平台都沒開放 → VALIDATION_FAILED（MFA_POLICY_NO_METHOD），不存檔',
      async (_label, values) => {
        const { service, repo } = setup({ platformEnabled: ['totp'] });
        const error = await rejection(
          service.update({ ...values, allowedMethods: ['email'], version: 1 }, ACTOR),
        );
        expect(error.code).toBe('VALIDATION_FAILED');
        expect(error.details).toEqual({ fields: { allowedMethods: 'MFA_POLICY_NO_METHOD' } });
        expect(repo.save).not.toHaveBeenCalled();
      },
    );

    it('不要求啟用時，即使沒有可用的方式也能存檔', async () => {
      const { service, repo } = setup({ platformEnabled: [] });
      await service.update(
        { requireAll: false, requiredRoleIds: [], allowedMethods: null, version: 1 },
        ACTOR,
      );
      expect(repo.save).toHaveBeenCalled();
    });

    it('版本不符 → MFA_POLICY_VERSION_CONFLICT，不寫稽核', async () => {
      const { service, repo, audit } = setup();
      repo.save.mockResolvedValue(false);
      const error = await rejection(
        service.update(
          { requireAll: true, requiredRoleIds: [], allowedMethods: null, version: 9 },
          ACTOR,
        ),
      );
      expect(error.code).toBe('MFA_POLICY_VERSION_CONFLICT');
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});
