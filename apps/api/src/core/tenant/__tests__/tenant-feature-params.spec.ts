import { describe, expect, it } from 'vitest';

import { runInTenantContext } from '../tenant-context';
import type { TenantContext } from '../tenant-context';
import {
  FILE_STORAGE_QUOTA_MB_PARAM,
  resolveTenantFeatureParam,
  TENANT_FEATURE_PARAMS,
  tenantFeatureParam,
  tenantFeatureParamProblem,
  toTenantFeatureParamOverrides,
} from '../tenant-feature-params';
import type { TenantStringParam } from '../tenant-feature-params';
import { TENANT_FEATURES } from '../tenant-features';

describe('feature 參數的目錄（docs/architecture/05-tenancy.md §13.2 D1）', () => {
  it('key 是 <feature>.<名稱>、不重複，所屬 feature 在 TENANT_FEATURES 裡', () => {
    const keys = TENANT_FEATURE_PARAMS.map((param) => param.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const param of TENANT_FEATURE_PARAMS) {
      expect(param.key.startsWith(`${param.feature}.`)).toBe(true);
      expect(TENANT_FEATURES).toContain(param.feature);
    }
  });

  it('預設值都在自己的範圍內', () => {
    for (const param of TENANT_FEATURE_PARAMS) {
      expect(tenantFeatureParamProblem(param, param.defaultValue)).toBeNull();
    }
  });

  it('需求的預設值：稽核 90 天、檔案 2 GB、webhook 網址 1 個', () => {
    const defaults = Object.fromEntries(TENANT_FEATURE_PARAMS.map((p) => [p.key, p.defaultValue]));
    expect(defaults).toMatchObject({
      'auditLog.hotRetentionDays': 90,
      'file.storageQuotaMb': 2048,
      'webhook.maxUrls': 1,
    });
  });
});

describe('tenantFeatureParamProblem', () => {
  const NAME: TenantStringParam = {
    key: 'file.label',
    feature: 'file',
    type: 'string',
    defaultValue: '',
    maxLength: 5,
    pattern: /^[a-z]*$/,
  };

  it.each([
    [1.5, 'must be an integer'],
    ['10', 'must be an integer'],
    [0, 'must be >= 1'],
    [10_485_761, 'must be <= 10485760'],
    [1, null],
  ])('整數 %s → %s', (value, problem) => {
    expect(tenantFeatureParamProblem(FILE_STORAGE_QUOTA_MB_PARAM, value)).toBe(problem);
  });

  it.each([
    [3, 'must be a string'],
    ['abcdef', 'must be at most 5 characters'],
    ['AB', 'invalid format'],
    ['ab', null],
  ])('字串 %s → %s', (value, problem) => {
    expect(tenantFeatureParamProblem(NAME, value)).toBe(problem);
  });
});

describe('覆寫值的讀取（D2、D6）', () => {
  it('只留目錄裡、值合法的項目', () => {
    expect(
      toTenantFeatureParamOverrides({
        'file.storageQuotaMb': 4096,
        'job.maxConcurrency': 0,
        'gone.param': 3,
      }),
    ).toEqual({ 'file.storageQuotaMb': 4096 });
    expect(toTenantFeatureParamOverrides(null)).toEqual({});
    expect(toTenantFeatureParamOverrides([1])).toEqual({});
  });

  it('生效值：有覆寫用覆寫，否則預設', () => {
    expect(resolveTenantFeatureParam(FILE_STORAGE_QUOTA_MB_PARAM, {})).toBe(2048);
    expect(
      resolveTenantFeatureParam(FILE_STORAGE_QUOTA_MB_PARAM, { 'file.storageQuotaMb': 10 }),
    ).toBe(10);
  });

  it('tenantFeatureParam 讀目前的租戶；沒有租戶脈絡時拋 TENANT_NOT_FOUND', () => {
    const tenant = { featureParams: { 'file.storageQuotaMb': 7 } } as unknown as TenantContext;
    expect(runInTenantContext(tenant, () => tenantFeatureParam(FILE_STORAGE_QUOTA_MB_PARAM))).toBe(
      7,
    );
    expect(() => tenantFeatureParam(FILE_STORAGE_QUOTA_MB_PARAM)).toThrow(
      expect.objectContaining({ code: 'TENANT_NOT_FOUND' }),
    );
  });
});
