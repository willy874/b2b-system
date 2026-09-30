import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { RequireFeature } from '@/common/decorators';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import { runInTenantContext } from '@/core/tenant';
import type { TenantContext, TenantFeature } from '@/core/tenant';

import { FeatureGuard } from '../feature.guard';

@RequireFeature('file')
class FileController {
  list(): void {}

  /** handler 的宣告蓋過 class 的 */
  @RequireFeature('auditLog')
  logs(): void {}
}

class PlainController {
  list(): void {}
}

function contextOf(
  controller: typeof FileController | typeof PlainController,
  method: 'list' | 'logs',
  type = 'http',
): ExecutionContext {
  const instance = new controller() as unknown as Record<string, () => void>;
  return {
    getType: () => type,
    getHandler: () => instance[method],
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

function tenantWith(features: TenantFeature[]): TenantContext {
  return {
    id: 't1',
    code: 't1',
    db: {} as Database,
    storageBucket: 'b2b-t1',
    allowExternalIdp: true,
    features,
  };
}

const guard = new FeatureGuard(new Reflector());

function inTenant(features: TenantFeature[], context: ExecutionContext): boolean {
  return runInTenantContext(tenantWith(features), () => guard.canActivate(context));
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppException) return error.code;
    throw error;
  }
  return undefined;
}

describe('FeatureGuard（docs/adr/0021-runtime-feature-activation.md D11）', () => {
  it('租戶啟用了宣告的 feature → 通過', () => {
    expect(inTenant(['file'], contextOf(FileController, 'list'))).toBe(true);
  });

  it('租戶沒有啟用 → FEATURE_DISABLED', () => {
    expect(codeOf(() => inTenant(['auditLog', 'job'], contextOf(FileController, 'list')))).toBe(
      'FEATURE_DISABLED',
    );
  });

  it('handler 的宣告蓋過 class 的', () => {
    expect(inTenant(['auditLog'], contextOf(FileController, 'logs'))).toBe(true);
    expect(codeOf(() => inTenant(['file'], contextOf(FileController, 'logs')))).toBe(
      'FEATURE_DISABLED',
    );
  });

  it('沒有宣告 @RequireFeature → 通過（常駐的端點），即使全部停用', () => {
    expect(inTenant([], contextOf(PlainController, 'list'))).toBe(true);
  });

  it('沒有租戶脈絡（平台的請求）→ 通過', () => {
    expect(guard.canActivate(contextOf(FileController, 'list'))).toBe(true);
  });

  it('WebSocket 不經過這裡 → 通過', () => {
    expect(inTenant([], contextOf(FileController, 'list', 'ws'))).toBe(true);
  });
});
