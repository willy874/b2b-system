import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { runInTenantContext } from '@/core/tenant';
import type { TenantContext, TenantFeature } from '@/core/tenant';

import { DataTransferRegistry } from '../data-transfer-registry.service';
import type { AnyTransferResource, TransferColumn } from '../data-transfer.types';
import { widgetResource } from './data-transfer.fixture';

function inTenant<T>(features: readonly string[], fn: () => T): T {
  return runInTenantContext({ features } as unknown as TenantContext, fn);
}

function column(overrides: Partial<TransferColumn<unknown>>): TransferColumn<unknown> {
  return {
    key: 'name',
    label: { 'zh-TW': '名稱', 'en-US': 'Name' },
    kind: 'string',
    export: { get: () => '' },
    ...overrides,
  };
}

const MATCH_KEY = column({
  key: 'email',
  import: { modes: ['update'], matchKey: 1, schema: z.string() },
});

/** 有新增與修改模式、欄位齊全的資源。 */
function importable(overrides: Partial<AnyTransferResource> = {}): AnyTransferResource {
  return widgetResource({
    columns: [MATCH_KEY, column({ import: { modes: ['create', 'update'], schema: z.string() } })],
    importer: {
      modes: { create: { permissions: [] }, update: { permissions: [] } },
      uniqueColumns: ['email'],
      create: async () => ({ id: 'x' }),
      update: async () => ({ id: 'x' }),
      resolveTargets: async () => new Map(),
    },
    ...overrides,
  });
}

/** require 用的登記表：完整的資源、要 feature 的匯出資源、只能新增匯入的資源。 */
function requireFixture(): DataTransferRegistry {
  const value = new DataTransferRegistry();
  value.register(importable());
  value.register(widgetResource({ type: 'exportOnly', feature: 'group' as TenantFeature }));
  value.register(
    widgetResource({
      type: 'importOnly',
      exporter: undefined,
      columns: [column({ import: { modes: ['create'], schema: z.string() } })],
      importer: { modes: { create: { permissions: [] } }, create: async () => ({ id: 'x' }) },
    }),
  );
  return value;
}

describe('DataTransferRegistry（docs/architecture/backend/22-data-transfer.md §5.1）', () => {
  describe('register：登記時檢查定義，寫錯就啟動失敗', () => {
    it('合法的定義登記後可以 find 取回', () => {
      const registry = new DataTransferRegistry();
      const resource = importable();
      registry.register(resource);
      expect(registry.find('widget')).toBe(resource);
      expect(registry.find('missing')).toBeUndefined();
    });

    it('類型不是 camelCase 時拒絕', () => {
      expect(() => new DataTransferRegistry().register(widgetResource({ type: 'Widget' }))).toThrow(
        'camelCase',
      );
    });

    it('同一個類型重複登記時拒絕', () => {
      const registry = new DataTransferRegistry();
      registry.register(widgetResource());
      expect(() => registry.register(widgetResource())).toThrow('重複登記');
    });

    it.each<[string, TransferColumn<unknown>[], string]>([
      ['欄位 key 不是 camelCase', [column({ key: 'Display_name' })], 'camelCase'],
      ['欄位重複', [column({}), column({})], '重複'],
      ['enum 缺少選項', [column({ kind: 'enum' })], '缺少 enum'],
      ['enum 的選項是空陣列', [column({ kind: 'enum', enum: [] })], '缺少 enum'],
      ['reference 缺少 reference', [column({ kind: 'reference' })], '缺少 reference'],
      [
        'json 欄位可以匯入',
        [column({ kind: 'json', import: { modes: ['create'], schema: z.unknown() } })],
        'json 不能匯入',
      ],
      ['既不能匯出也不能匯入', [column({ export: undefined })], '既不能匯出也不能匯入'],
      [
        '比對鍵用在非修改模式',
        [column({ import: { modes: ['create'], matchKey: 1, schema: z.string() } })],
        '比對鍵只用在修改模式',
      ],
      [
        '修改模式的欄位不能匯出',
        [column({ export: undefined, import: { modes: ['update'], schema: z.string() } })],
        '修改模式的欄位要能匯出',
      ],
    ])('%s時拒絕', (_name, columns, message) => {
      expect(() => new DataTransferRegistry().register(widgetResource({ columns }))).toThrow(
        message,
      );
    });

    it('支援新增模式卻沒有 create() 時拒絕', () => {
      const resource = importable();
      expect(() =>
        new DataTransferRegistry().register({
          ...resource,
          importer: { ...resource.importer!, create: undefined },
        }),
      ).toThrow('沒有 create()');
    });

    it.each(['update', 'resolveTargets'] as const)('支援修改模式卻沒有 %s 時拒絕', (missing) => {
      const resource = importable();
      expect(() =>
        new DataTransferRegistry().register({
          ...resource,
          importer: { ...resource.importer!, [missing]: undefined },
        }),
      ).toThrow('update()／resolveTargets()');
    });

    it('支援修改模式卻沒有比對鍵時拒絕', () => {
      expect(() =>
        new DataTransferRegistry().register(
          importable({
            columns: [column({ import: { modes: ['create', 'update'], schema: z.string() } })],
            importer: {
              modes: { update: { permissions: [] } },
              update: async () => ({ id: 'x' }),
              resolveTargets: async () => new Map(),
            },
          }),
        ),
      ).toThrow('沒有比對鍵');
    });

    it('唯一欄不存在時拒絕', () => {
      const resource = importable();
      expect(() =>
        new DataTransferRegistry().register({
          ...resource,
          importer: { ...resource.importer!, uniqueColumns: ['missing'] },
        }),
      ).toThrow('唯一欄 missing 不存在');
    });

    describe('同檔引用（§7.8）', () => {
      const reference = { resolve: async () => new Map(), search: async () => [] };
      function withParent(
        parent: Partial<TransferColumn<unknown>>,
        uniqueColumns?: readonly string[],
      ): AnyTransferResource {
        return widgetResource({
          columns: [
            column({ key: 'code', import: { modes: ['create'], schema: z.string() } }),
            column({
              key: 'parent',
              kind: 'reference',
              reference: { ...reference, sameFile: { column: 'code' } },
              import: { modes: ['create'], schema: z.string() },
              ...parent,
            }),
          ],
          importer: {
            modes: { create: { permissions: [] } },
            create: async () => ({ id: 'x' }),
            uniqueColumns,
          },
        });
      }

      it('被引用的欄位是唯一欄、單一值時可以登記', () => {
        expect(() => new DataTransferRegistry().register(withParent({}, ['code']))).not.toThrow();
      });

      it('被引用的欄位不是唯一欄時拒絕', () => {
        expect(() => new DataTransferRegistry().register(withParent({}))).toThrow(
          '同檔引用的 code 要是唯一欄',
        );
      });

      it('多值欄位用同檔引用時拒絕', () => {
        expect(() =>
          new DataTransferRegistry().register(withParent({ multiple: {} }, ['code'])),
        ).toThrow('同檔引用只能用在單一值的欄位');
      });
    });

    it('只有匯出、沒有 importer 的資源不做匯入的檢查', () => {
      expect(() => new DataTransferRegistry().register(widgetResource())).not.toThrow();
    });
  });

  describe('list：目前租戶可用的資源', () => {
    it('沒有所屬 feature 的一律列出；有 feature 的只在租戶啟用時列出', () => {
      const registry = new DataTransferRegistry();
      registry.register(widgetResource());
      registry.register(widgetResource({ type: 'gadget', feature: 'group' as TenantFeature }));
      expect(inTenant([], () => registry.list().map((r) => r.type))).toEqual(['widget']);
      expect(inTenant(['group'], () => registry.list().map((r) => r.type))).toEqual([
        'widget',
        'gadget',
      ]);
    });
  });

  describe('require', () => {
    it('找不到類型時拋 DATA_TRANSFER_TYPE_UNSUPPORTED', () => {
      expect(() => inTenant([], () => requireFixture().require('missing'))).toThrow(
        expect.objectContaining({
          code: 'DATA_TRANSFER_TYPE_UNSUPPORTED',
          details: { type: 'missing' },
        }),
      );
    });

    it('所屬 feature 沒有啟用時拋 FEATURE_DISABLED', () => {
      expect(() => inTenant([], () => requireFixture().require('exportOnly'))).toThrow(
        expect.objectContaining({ code: 'FEATURE_DISABLED', details: { feature: 'group' } }),
      );
      expect(inTenant(['group'], () => requireFixture().require('exportOnly')).type).toBe(
        'exportOnly',
      );
    });

    it('沒有 exporter 時不能匯出', () => {
      expect(() => inTenant([], () => requireFixture().require('importOnly', 'export'))).toThrow(
        expect.objectContaining({
          code: 'DATA_TRANSFER_TYPE_UNSUPPORTED',
          details: { type: 'importOnly', direction: 'export' },
        }),
      );
    });

    it('沒有 importer 時不能匯入；指定模式時要支援那個模式', () => {
      const value = requireFixture();
      expect(() => inTenant(['group'], () => value.require('exportOnly', 'import'))).toThrow(
        expect.objectContaining({ code: 'DATA_TRANSFER_TYPE_UNSUPPORTED' }),
      );
      expect(() => inTenant([], () => value.require('importOnly', 'import', 'update'))).toThrow(
        expect.objectContaining({
          code: 'DATA_TRANSFER_TYPE_UNSUPPORTED',
          details: { type: 'importOnly', direction: 'import', mode: 'update' },
        }),
      );
      expect(inTenant([], () => value.require('importOnly', 'import', 'create')).type).toBe(
        'importOnly',
      );
      expect(inTenant([], () => value.require('importOnly', 'import')).type).toBe('importOnly');
      expect(inTenant([], () => value.require('widget', 'export')).type).toBe('widget');
    });
  });
});
