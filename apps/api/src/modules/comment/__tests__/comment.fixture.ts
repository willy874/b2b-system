import { ChangeSource } from '@b2b-system/realtime';
import { expect, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import { AppException } from '@/core/errors';
import { runInTenantContext } from '@/core/tenant';
import type { TenantContext, TenantFeature } from '@/core/tenant';
import type { CommentRow } from '@/db/schema';

import { CommentResourceRegistry } from '../comment.registry';
import type { CommentTarget } from '../comment.types';

export const ACTOR = {
  id: '00000000-0000-4000-8000-0000000000a1',
  email: 'a@example.com',
} as AuthUser;
export const OTHER = '00000000-0000-4000-8000-0000000000b2';
export const THIRD = '00000000-0000-4000-8000-0000000000c3';
export const RESOURCE_ID = '00000000-0000-4000-8000-0000000000f0';
export const TARGET: CommentTarget = {
  name: '王小明',
  link: { route: 'user.detail', params: { userId: RESOURCE_ID } },
};

export function commentRow(overrides: Partial<CommentRow> = {}): CommentRow {
  return {
    id: '00000000-0000-4000-8000-000000000c01',
    resourceType: 'user',
    resourceId: RESOURCE_ID,
    authorId: ACTOR.id,
    body: '請確認這位同事的權限',
    mentions: [],
    version: 1,
    editedAt: null,
    createdAt: new Date('2026-10-08T00:00:00Z'),
    ...overrides,
  };
}

/** 登記一種資源（`user`）的登記表；`viewers` 是「看得到」的人，不在裡面的會被 `filterViewers` 濾掉。 */
export function registryWith(options: { feature?: TenantFeature; viewers?: string[] } = {}) {
  const registry = new CommentResourceRegistry();
  const viewers = new Set(options.viewers ?? [ACTOR.id, OTHER, THIRD]);
  const definition = {
    resourceType: 'user',
    changeSource: ChangeSource.USER,
    feature: options.feature,
    resolveViewable: vi.fn(async (): Promise<CommentTarget> => TARGET),
    describe: vi.fn(async (): Promise<CommentTarget | undefined> => TARGET),
    filterViewers: vi.fn(async (_id: string, ids: readonly string[]) =>
      ids.filter((id) => viewers.has(id)),
    ),
  };
  registry.register(definition);
  return { registry, definition };
}

export function inTenant<T>(fn: () => Promise<T>, features: TenantFeature[] = ['file']) {
  return runInTenantContext({ id: 't', code: 'acme', features } as unknown as TenantContext, fn);
}

export async function expectCode(promise: Promise<unknown>, code: string, details?: object) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  expect((error as AppException).code).toBe(code);
  if (details) expect((error as AppException).details).toMatchObject(details);
}
