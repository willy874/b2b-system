import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { RequireFeature, RequireFlag } from '@/common/decorators';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import type { FeatureFlagService } from '@/core/feature-flags';
import { currentTenant, runInTenantContext } from '@/core/tenant';
import type { TenantContext, TenantFeature } from '@/core/tenant';

import { FeatureGuard } from '../feature.guard';

@RequireFeature('file')
class FileController {
  list(): void {}

  /** handler 與 class 的宣告合併：兩者都要啟用 */
  @RequireFeature('trash')
  logs(): void {}
}

class PlainController {
  list(): void {}
}

@RequireFlag('levelEditor.v2')
class TrialController {
  list(): void {}

  /** 兩者並存：feature 與 flag 都要成立 */
  @RequireFeature('file')
  logs(): void {}
}

function contextOf(
  controller: typeof FileController | typeof PlainController | typeof TrialController,
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

function tenantWith(features: TenantFeature[], flags: Record<string, boolean> = {}): TenantContext {
  return {
    id: 't1',
    code: 't1',
    db: {} as Database,
    storageBucket: 'b2b-t1',
    features,
    flags,
  };
}

/** 判斷交給 FeatureFlagService（生效值的規則在它的測試裡）；這裡只看租戶層的覆寫。 */
const flagService = {
  isEnabled: (key: string) => currentTenant()?.flags[key] === true,
} as unknown as FeatureFlagService;

const guard = new FeatureGuard(new Reflector(), flagService);

function inTenant(
  features: TenantFeature[],
  context: ExecutionContext,
  flags: Record<string, boolean> = {},
): boolean {
  return runInTenantContext(tenantWith(features, flags), () => guard.canActivate(context));
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

  it('handler 與 class 的宣告合併：都啟用才通過（docs/adr/0029-toggleable-platform-features.md D3）', () => {
    expect(inTenant(['file', 'trash'], contextOf(FileController, 'logs'))).toBe(true);
    expect(codeOf(() => inTenant(['file'], contextOf(FileController, 'logs')))).toBe(
      'FEATURE_DISABLED',
    );
    expect(codeOf(() => inTenant(['trash'], contextOf(FileController, 'logs')))).toBe(
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

describe('FeatureGuard 的 @RequireFlag（docs/adr/0022-feature-flags.md D5）', () => {
  it('flag 開啟 → 通過', () => {
    expect(inTenant([], contextOf(TrialController, 'list'), { 'levelEditor.v2': true })).toBe(true);
  });

  it('flag 關閉 → FEATURE_DISABLED', () => {
    expect(codeOf(() => inTenant([], contextOf(TrialController, 'list')))).toBe('FEATURE_DISABLED');
  });

  it('與 @RequireFeature 並存時兩者都要成立', () => {
    const on = { 'levelEditor.v2': true };
    expect(inTenant(['file'], contextOf(TrialController, 'logs'), on)).toBe(true);
    expect(codeOf(() => inTenant([], contextOf(TrialController, 'logs'), on))).toBe(
      'FEATURE_DISABLED',
    );
    expect(codeOf(() => inTenant(['file'], contextOf(TrialController, 'logs')))).toBe(
      'FEATURE_DISABLED',
    );
  });

  it('沒有租戶脈絡 → 通過', () => {
    expect(guard.canActivate(contextOf(TrialController, 'list'))).toBe(true);
  });
});
