import { ChangeKind } from '@b2b-system/realtime';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { Transaction } from '@/core/database';
import { AppException } from '@/core/errors';
import type { TagRow } from '@/db/schema';
import type { DataTransferRegistry } from '@/modules/data-transfer/data-transfer-registry.service';
import type {
  AnyTransferResource,
  ResolvedRow,
  TransferContext,
} from '@/modules/data-transfer/data-transfer.types';

import type { TagRepository } from '../tag.repository';
import type { TagService } from '../tag.service';
import { TagTransferResource } from '../tag.transfer';

const ACTOR = { id: 'admin-1', email: 'admin@example.com' } as AuthUser;
const CTX = { actor: ACTOR } as TransferContext;
const TX = { tx: true } as unknown as Transaction;

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';

function tag(id: string, overrides: Partial<TagRow> = {}): TagRow {
  return {
    id,
    scope: 'file',
    name: `標籤 ${id.slice(0, 4)}`,
    color: 'neutral',
    version: 1,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    createdBy: null,
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    updatedBy: null,
    ...overrides,
  };
}

function setup() {
  let resource: AnyTransferResource | undefined;
  const registry = {
    register: vi.fn((value: AnyTransferResource) => {
      resource = value;
    }),
  };
  const repo = {
    findByIds: vi.fn(async (_ids: readonly string[]): Promise<TagRow[]> => []),
    listByScopes: vi.fn(async (_scopes: readonly string[]): Promise<TagRow[]> => []),
    findByNames: vi.fn(async (_scope: string, _names: readonly string[]): Promise<TagRow[]> => []),
  };
  const tags = {
    registeredScopes: vi.fn(() => [
      { scope: 'file', label: { 'zh-TW': '檔案', 'en-US': 'Files' } },
      { scope: 'user' },
    ]),
    availableScopes: vi.fn(() => [{ scope: 'file' }]),
    assertCanBrowse: vi.fn(async (_scope: string, _actor: AuthUser, _audit: unknown) => undefined),
    createInTx: vi.fn(async (dto: Partial<TagRow>) => tag(ID_C, dto)),
    updateInTx: vi.fn(async () => tag(ID_A, { version: 2 })),
    publishChanged: vi.fn(),
  };
  const transfer = new TagTransferResource(
    registry as unknown as DataTransferRegistry,
    repo as unknown as TagRepository,
    tags as unknown as TagService,
  );
  transfer.onApplicationBootstrap();
  if (!resource) throw new Error('沒有登記資源');
  const { exporter, importer } = resource;
  if (!exporter || !importer) throw new Error('缺少 exporter 或 importer');
  return { resource, exporter, importer, repo, tags, registry };
}

async function collect<T>(iterable: AsyncIterable<readonly T[]>): Promise<T[][]> {
  const pages: T[][] = [];
  for await (const page of iterable) pages.push([...page]);
  return pages;
}

function column(resource: AnyTransferResource, key: string) {
  const found = resource.columns.find((item) => item.key === key);
  if (!found) throw new Error(`沒有欄位 ${key}`);
  return found;
}

function createRow(rowNo: number, values: Record<string, unknown>): ResolvedRow {
  return { rowNo, values };
}

describe('TagTransferResource（docs/architecture/backend/22-data-transfer.md §12.4）', () => {
  describe('登記', () => {
    it('在 bootstrap 時登記 tag 資源，標籤組欄列出全部登記的組，沒有名稱的以 scope 當名稱', () => {
      const { resource, registry } = setup();
      expect(registry.register).toHaveBeenCalledTimes(1);
      expect(resource.type).toBe('tag');
      expect(column(resource, 'scope').enum).toEqual([
        { value: 'file', label: { 'zh-TW': '檔案', 'en-US': 'Files' } },
        { value: 'user', label: { 'zh-TW': 'user', 'en-US': 'user' } },
      ]);
      expect(column(resource, 'color').enum?.map((option) => option.value)).toEqual([
        'neutral',
        'brand',
        'success',
        'warning',
        'danger',
      ]);
    });

    it('各欄的匯出值取自標籤的對應欄位', () => {
      const { resource } = setup();
      const row = tag(ID_A, { name: 'VIP', color: 'brand' });
      expect(
        Object.fromEntries(resource.columns.map((item) => [item.key, item.export?.get(row)])),
      ).toEqual({
        id: ID_A,
        scope: 'file',
        name: 'VIP',
        color: 'brand',
        createdAt: row.createdAt,
      });
    });
  });

  describe('匯出', () => {
    it('篩選範圍：先檢查能進標籤組（帶稽核資訊），再列出該組的標籤', async () => {
      const { exporter, repo, tags } = setup();
      repo.listByScopes.mockResolvedValue([tag(ID_A), tag(ID_B)]);
      const scope = { kind: 'filter' as const, filter: { scope: 'file' } };

      expect(await collect(exporter.iterate(scope, CTX))).toEqual([[tag(ID_A), tag(ID_B)]]);
      expect(await exporter.count(scope, CTX)).toBe(2);
      expect(tags.assertCanBrowse).toHaveBeenCalledWith('file', ACTOR, {
        route: 'data-transfer: tag',
        metadata: { scope: 'file' },
      });
      expect(repo.listByScopes).toHaveBeenCalledWith(['file']);
    });

    it('勾選範圍：讀出指定的標籤，每個出現的標籤組各檢查一次', async () => {
      const { exporter, repo, tags } = setup();
      repo.findByIds.mockResolvedValue([
        tag(ID_A, { scope: 'file' }),
        tag(ID_B, { scope: 'file' }),
        tag(ID_C, { scope: 'user' }),
      ]);

      const count = await exporter.count({ kind: 'ids', ids: [ID_A, ID_B, ID_C] }, CTX);

      expect(count).toBe(3);
      expect(repo.findByIds).toHaveBeenCalledWith([ID_A, ID_B, ID_C]);
      expect(tags.assertCanBrowse.mock.calls.map((call) => call[0])).toEqual(['file', 'user']);
    });

    it('沒有標籤時不產生任何一頁', async () => {
      const { exporter } = setup();
      expect(await collect(exporter.iterate({ kind: 'ids', ids: [] }, CTX))).toEqual([]);
    });

    it('進不了標籤組時把錯誤往外拋，不讀標籤', async () => {
      const { exporter, repo, tags } = setup();
      tags.assertCanBrowse.mockRejectedValue(new AppException('AUTHZ_FORBIDDEN'));
      await expect(
        exporter.count({ kind: 'filter', filter: { scope: 'file' } }, CTX),
      ).rejects.toMatchObject({ code: 'AUTHZ_FORBIDDEN' });
      expect(repo.listByScopes).not.toHaveBeenCalled();
    });

    it.each([
      ['合法的標籤組', 'customField', true],
      ['大寫開頭', 'File', false],
      ['含連字號', 'my-scope', false],
      ['超過 50 字', `a${'b'.repeat(50)}`, false],
    ])('篩選條件：%s → %s', (_label, scope, ok) => {
      const { exporter } = setup();
      expect(exporter.filterSchema.safeParse({ scope }).success).toBe(ok);
    });
  });

  describe('比對目標', () => {
    it('只以 UUID 查詢，key 轉小寫，帶名稱與版本', async () => {
      const { importer, repo } = setup();
      const row = tag(ID_A, { name: 'VIP', version: 3 });
      repo.findByIds.mockResolvedValue([row]);

      const found = await importer.resolveTargets?.('id', [ID_A.toUpperCase(), 'not-a-uuid'], CTX);

      expect(repo.findByIds).toHaveBeenCalledWith([ID_A.toUpperCase()]);
      expect(found).toEqual(
        new Map([[ID_A, [{ id: ID_A, label: 'VIP', version: 3, record: row }]]]),
      );
    });

    it('手動指定目標：回傳找到的那一筆，找不到的不出現', async () => {
      const { importer, repo } = setup();
      const row = tag(ID_A);
      repo.findByIds.mockResolvedValue([row]);

      const found = await importer.findTargetsById?.([ID_A, ID_B], CTX);

      expect(found).toEqual(
        new Map([[ID_A, { id: ID_A, label: row.name, version: 1, record: row }]]),
      );
    });

    it('範本的抽樣只取目前租戶可用的標籤組', async () => {
      const { importer, repo } = setup();
      repo.listByScopes.mockResolvedValue([tag(ID_A)]);
      expect(await importer.sampleRecords?.(CTX, 5)).toEqual([tag(ID_A)]);
      expect(repo.listByScopes).toHaveBeenCalledWith(['file']);
    });
  });

  describe('套用', () => {
    it('新增：沒填顏色時是灰色，交易後推播 CREATE', async () => {
      const { importer, tags } = setup();

      const result = await importer.create?.({ scope: 'file', name: 'VIP' }, CTX, TX);

      expect(tags.createInTx).toHaveBeenCalledWith(
        { scope: 'file', name: 'VIP', color: 'neutral' },
        ACTOR,
        TX,
      );
      expect(result?.id).toBe(ID_C);
      const effect = result?.after?.[0];
      expect(effect).toMatchObject({ kind: 'custom', key: `tag:${ID_C}` });
      if (effect?.kind === 'custom') await effect.run();
      expect(tags.publishChanged).toHaveBeenCalledWith(ChangeKind.CREATE, ID_C);
    });

    it('新增：有填顏色時照填的顏色', async () => {
      const { importer, tags } = setup();
      await importer.create?.({ scope: 'file', name: 'VIP', color: 'danger' }, CTX, TX);
      expect(tags.createInTx).toHaveBeenCalledWith(
        { scope: 'file', name: 'VIP', color: 'danger' },
        ACTOR,
        TX,
      );
    });

    it('修改：只送有變更的名稱與顏色，帶目標的版本，交易後推播 UPDATE', async () => {
      const { importer, tags } = setup();

      const result = await importer.update?.(
        { id: ID_A, version: 4 },
        { name: '新名稱', color: 'success' },
        CTX,
        TX,
      );

      expect(tags.updateInTx).toHaveBeenCalledWith(
        ID_A,
        { name: '新名稱', color: 'success', version: 4 },
        ACTOR,
        TX,
      );
      const effect = result?.after?.[0];
      expect(effect).toMatchObject({ kind: 'custom', key: `tag:${ID_A}` });
      if (effect?.kind === 'custom') await effect.run();
      expect(tags.publishChanged).toHaveBeenCalledWith(ChangeKind.UPDATE, ID_A);
    });

    it('修改：沒有變更的欄位時只送版本', async () => {
      const { importer, tags } = setup();
      await importer.update?.({ id: ID_A, version: 2 }, {}, CTX, TX);
      expect(tags.updateInTx).toHaveBeenCalledWith(ID_A, { version: 2 }, ACTOR, TX);
    });
  });

  describe('validateRows（標籤組的權限與組內撞名）', () => {
    it('新增：組內已有同名（不分大小寫）的標籤 → name 欄 alreadyExists', async () => {
      const { importer, repo } = setup();
      repo.findByNames.mockResolvedValue([tag(ID_A, { name: 'VIP' })]);

      const issues = await importer.validateRows?.(
        'create',
        [
          createRow(2, { scope: 'file', name: 'vip' }),
          createRow(3, { scope: 'file', name: 'New' }),
        ],
        CTX,
      );

      expect(repo.findByNames).toHaveBeenCalledWith('file', ['vip', 'New']);
      expect(issues).toEqual(
        new Map([
          [
            2,
            [
              {
                column: 'name',
                code: 'alreadyExists',
                params: { value: 'vip' },
                severity: 'error',
              },
            ],
          ],
        ]),
      );
    });

    it('新增：進不了的標籤組 → scope 欄 forbidden，且不查名稱', async () => {
      const { importer, repo, tags } = setup();
      tags.assertCanBrowse.mockImplementation(async (scope: string) => {
        if (scope === 'user') throw new AppException('FEATURE_DISABLED');
      });

      const issues = await importer.validateRows?.(
        'create',
        [createRow(2, { scope: 'user', name: 'A' }), createRow(3, { scope: 'file', name: 'B' })],
        CTX,
      );

      expect(issues).toEqual(
        new Map([[2, [{ column: 'scope', code: 'forbidden', severity: 'error' }]]]),
      );
      expect(repo.findByNames).toHaveBeenCalledTimes(1);
      expect(repo.findByNames).toHaveBeenCalledWith('file', ['B']);
    });

    it('新增：沒填標籤組時以空字串檢查，進不了 → forbidden', async () => {
      const { importer, tags } = setup();
      tags.assertCanBrowse.mockRejectedValue(new AppException('VALIDATION_FAILED'));

      const issues = await importer.validateRows?.('create', [createRow(2, { name: 'A' })], CTX);

      expect(tags.assertCanBrowse).toHaveBeenCalledWith('', ACTOR, expect.anything());
      expect(issues?.get(2)).toEqual([{ column: 'scope', code: 'forbidden', severity: 'error' }]);
    });

    it('檢查權限時遇到不是 AppException 的錯誤 → 原樣拋出', async () => {
      const { importer, tags } = setup();
      tags.assertCanBrowse.mockRejectedValue(new Error('db down'));
      await expect(
        importer.validateRows?.('create', [createRow(2, { scope: 'file', name: 'A' })], CTX),
      ).rejects.toThrow('db down');
    });

    it('沒填名稱的列不查撞名', async () => {
      const { importer, repo } = setup();
      const issues = await importer.validateRows?.(
        'create',
        [createRow(2, { scope: 'file', color: 'brand' })],
        CTX,
      );
      expect(repo.findByNames).not.toHaveBeenCalled();
      expect(issues?.size).toBe(0);
    });

    it('修改：標籤組取自比對到的目標；同名的是自己時不算撞名', async () => {
      const { importer, repo } = setup();
      const self = tag(ID_A, { scope: 'user', name: 'VIP' });
      const other = tag(ID_B, { scope: 'user', name: 'Gold' });
      repo.findByNames.mockResolvedValue([self, other]);

      const issues = await importer.validateRows?.(
        'update',
        [
          {
            rowNo: 2,
            values: { name: 'vip' },
            target: { id: ID_A, label: 'VIP', version: 1, record: self },
          },
          {
            rowNo: 3,
            values: { name: 'GOLD' },
            target: { id: ID_C, label: 'X', version: 1, record: tag(ID_C, { scope: 'user' }) },
          },
        ],
        CTX,
      );

      expect(repo.findByNames).toHaveBeenCalledWith('user', ['vip', 'GOLD']);
      expect(issues).toEqual(
        new Map([
          [
            3,
            [
              {
                column: 'name',
                code: 'alreadyExists',
                params: { value: 'GOLD' },
                severity: 'error',
              },
            ],
          ],
        ]),
      );
    });

    it('修改：進不了目標的標籤組 → forbidden 不指向欄位；沒有目標時以空字串檢查', async () => {
      const { importer, tags } = setup();
      tags.assertCanBrowse.mockRejectedValue(new AppException('AUTHZ_FORBIDDEN'));

      const issues = await importer.validateRows?.(
        'update',
        [
          {
            rowNo: 2,
            values: { name: 'A' },
            target: { id: ID_A, label: 'A', version: 1, record: tag(ID_A) },
          },
          { rowNo: 3, values: { name: 'B' } },
        ],
        CTX,
      );

      expect(tags.assertCanBrowse.mock.calls.map((call) => call[0])).toEqual(['file', '']);
      expect(issues).toEqual(
        new Map([
          [2, [{ column: null, code: 'forbidden', severity: 'error' }]],
          [3, [{ column: null, code: 'forbidden', severity: 'error' }]],
        ]),
      );
    });
  });
});
