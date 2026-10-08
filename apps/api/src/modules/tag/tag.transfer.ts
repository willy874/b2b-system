import { ChangeKind } from '@b2b-system/realtime';
import { Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { z } from 'zod';

import { PERMISSION } from '@/common/types';
import { AppException } from '@/core/errors';
import type { TagRow } from '@/db/schema';
import { TAG_COLORS } from '@/db/schema';
import { DataTransferRegistry } from '@/modules/data-transfer/data-transfer-registry.service';
import { defineTransferResource } from '@/modules/data-transfer/data-transfer.definition';
import type {
  ExportScope,
  MatchResult,
  ResolvedRow,
  RowIssue,
  TransferContext,
} from '@/modules/data-transfer/data-transfer.types';

import { CreateTagSchema } from './dto/tag.dto';
import { TagRepository } from './tag.repository';
import { TagService } from './tag.service';

/** 匯出一個標籤組（標籤管理頁一次看一組）；匯入時標籤組是每一列的欄位。 */
const TagExportFilterSchema = z.object({
  scope: z
    .string()
    .trim()
    .regex(/^[a-z][A-Za-z0-9]*$/)
    .max(50),
});
type TagExportFilter = z.infer<typeof TagExportFilterSchema>;

const UUID = z.string().uuid();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLOR_LABEL: Record<(typeof TAG_COLORS)[number], { 'zh-TW': string; 'en-US': string }> = {
  neutral: { 'zh-TW': '灰', 'en-US': 'Neutral' },
  brand: { 'zh-TW': '藍', 'en-US': 'Brand' },
  success: { 'zh-TW': '綠', 'en-US': 'Success' },
  warning: { 'zh-TW': '黃', 'en-US': 'Warning' },
  danger: { 'zh-TW': '紅', 'en-US': 'Danger' },
};

/**
 * 標籤定義的匯入匯出（docs/architecture/backend/22-data-transfer.md §12.4）：名稱與顏色，依標籤組。
 * 指派（哪個資源貼了哪些標籤）不在這裡。標籤沒有讀取權限（D5：進得了標籤組就讀得到），所以每一組照樣檢查
 * `assertCanBrowse`；套用走 `TagService` 的交易內版本（上限、組內撞名）。
 */
@Injectable()
export class TagTransferResource implements OnApplicationBootstrap {
  constructor(
    private readonly registry: DataTransferRegistry,
    private readonly repo: TagRepository,
    private readonly tags: TagService,
  ) {}

  /** 在所有模組的 `onModuleInit`（標籤組的登記）之後才登記：「標籤組」欄的選項要列出全部的組。 */
  onApplicationBootstrap(): void {
    this.registry.register(
      defineTransferResource<TagExportFilter, TagRow>({
        type: 'tag',
        fileBaseName: 'tags',
        label: { 'zh-TW': '標籤', 'en-US': 'Tags' },
        columns: [
          {
            key: 'id',
            label: { 'zh-TW': 'ID', 'en-US': 'ID' },
            kind: 'string',
            hint: {
              'zh-TW': '修改模式的比對鍵。',
              'en-US': 'Match key in update mode.',
            },
            export: { get: (tag) => tag.id },
            import: { modes: ['update'], matchKey: 1, schema: UUID },
          },
          {
            key: 'scope',
            label: { 'zh-TW': '標籤組', 'en-US': 'Tag group' },
            kind: 'enum',
            // 全部登記的組；租戶沒啟用的組（所屬 feature 關閉）在驗證時以 `forbidden` 擋下
            enum: this.tags.registeredScopes().map((definition) => ({
              value: definition.scope,
              label: definition.label ?? { 'zh-TW': definition.scope, 'en-US': definition.scope },
            })),
            hint: {
              'zh-TW': '標籤屬於哪一種資源（使用者、檔案…），建立後不能修改。',
              'en-US': 'Which kind of resource the tag is for (users, files…); cannot be changed.',
            },
            export: { get: (tag) => tag.scope },
            import: { modes: ['create'], requiredOnCreate: true, schema: z.string() },
          },
          {
            key: 'name',
            label: { 'zh-TW': '名稱', 'en-US': 'Name' },
            kind: 'string',
            example: 'VIP',
            hint: {
              'zh-TW': '同一個標籤組內不可重複（不分大小寫）。',
              'en-US': 'Unique within the tag group (case-insensitive).',
            },
            export: { get: (tag) => tag.name },
            import: {
              modes: ['create', 'update'],
              requiredOnCreate: true,
              schema: CreateTagSchema.shape.name,
            },
          },
          {
            key: 'color',
            label: { 'zh-TW': '顏色', 'en-US': 'Color' },
            kind: 'enum',
            enum: TAG_COLORS.map((color) => ({ value: color, label: COLOR_LABEL[color] })),
            hint: { 'zh-TW': '新增時不填是灰色。', 'en-US': 'Neutral when empty.' },
            export: { get: (tag) => tag.color },
            import: { modes: ['create', 'update'], schema: z.enum(TAG_COLORS) },
          },
          {
            key: 'createdAt',
            label: { 'zh-TW': '建立時間', 'en-US': 'Created at' },
            kind: 'datetime',
            export: { get: (tag) => tag.createdAt },
          },
        ],
        exporter: {
          permissions: [PERMISSION.TAG_EXPORT],
          filterSchema: TagExportFilterSchema,
          idSchema: UUID,
          orderHint: { 'zh-TW': '依名稱排序', 'en-US': 'Sorted by name' },
          iterate: (scope, ctx) => this.iterate(scope, ctx),
          count: async (scope, ctx) => (await this.inScope(scope, ctx)).length,
        },
        importer: {
          modes: {
            create: { permissions: [PERMISSION.TAG_CREATE] },
            update: { permissions: [PERMISSION.TAG_UPDATE] },
          },
          resolveTargets: (_column, values) => this.resolveTargets(values),
          findTargetsById: async (ids) => {
            const found = await this.resolveTargets(ids);
            return new Map(
              [...found].flatMap(([id, matches]) => (matches[0] ? [[id, matches[0]]] : [])),
            );
          },
          validateRows: (mode, rows, ctx) => this.validateRows(mode, rows, ctx),
          sampleRecords: async () =>
            this.repo.listByScopes(this.tags.availableScopes().map((item) => item.scope)),
          create: async (values, ctx, tx) => {
            const tag = await this.tags.createInTx(
              {
                scope: String(values.scope),
                name: String(values.name),
                color: (values.color as (typeof TAG_COLORS)[number] | undefined) ?? 'neutral',
              },
              ctx.actor,
              tx,
            );
            return { id: tag.id, after: [this.publishEffect(ChangeKind.CREATE, tag.id)] };
          },
          update: async (target, patch, ctx, tx) => {
            await this.tags.updateInTx(
              target.id,
              {
                ...('name' in patch ? { name: String(patch.name) } : {}),
                ...('color' in patch ? { color: patch.color as (typeof TAG_COLORS)[number] } : {}),
                version: target.version,
              },
              ctx.actor,
              tx,
            );
            return { id: target.id, after: [this.publishEffect(ChangeKind.UPDATE, target.id)] };
          },
        },
      }),
    );
  }

  private publishEffect(kind: ChangeKind, id: string) {
    return {
      kind: 'custom' as const,
      key: `tag:${id}`,
      run: () => this.tags.publishChanged(kind, id),
    };
  }

  /** 匯出的標籤組：要進得了它（D5，拒絕會寫 `authz.denied`）。 */
  private async inScope(
    scope: ExportScope<TagExportFilter>,
    ctx: TransferContext,
  ): Promise<TagRow[]> {
    if (scope.kind === 'ids') {
      const rows = await this.repo.findByIds(scope.ids);
      for (const group of new Set(rows.map((row) => row.scope))) {
        await this.browse(group, ctx);
      }
      return rows;
    }
    await this.browse(scope.filter.scope, ctx);
    return this.repo.listByScopes([scope.filter.scope]);
  }

  private async *iterate(
    scope: ExportScope<TagExportFilter>,
    ctx: TransferContext,
  ): AsyncIterable<readonly TagRow[]> {
    const rows = await this.inScope(scope, ctx);
    if (rows.length) yield rows;
  }

  private browse(scope: string, ctx: TransferContext): Promise<void> {
    return this.tags.assertCanBrowse(scope, ctx.actor, {
      route: 'data-transfer: tag',
      metadata: { scope },
    });
  }

  private async resolveTargets(
    values: readonly string[],
  ): Promise<ReadonlyMap<string, readonly MatchResult<TagRow>[]>> {
    const rows = await this.repo.findByIds(values.filter((value) => UUID_PATTERN.test(value)));
    return new Map(
      rows.map((row) => [
        row.id.toLowerCase(),
        [{ id: row.id, label: row.name, version: row.version, record: row }],
      ]),
    );
  }

  /**
   * 標籤特有的檢查：進不了標籤組 → `forbidden`；組內已經有同名的標籤 → `alreadyExists`
   * （唯一性是「組 × 名稱」，框架的唯一欄只看單一欄位，所以在這裡查）。
   */
  private async validateRows(
    mode: 'create' | 'update',
    rows: readonly ResolvedRow[],
    ctx: TransferContext,
  ): Promise<ReadonlyMap<number, readonly RowIssue[]>> {
    const issues = new Map<number, RowIssue[]>();
    const push = (rowNo: number, issue: RowIssue) =>
      issues.set(rowNo, [...(issues.get(rowNo) ?? []), issue]);
    const scopeOf = (row: ResolvedRow) =>
      mode === 'create'
        ? String(row.values.scope ?? '')
        : ((row.target?.record as TagRow | undefined)?.scope ?? '');

    const allowed = new Map<string, boolean>();
    for (const scope of new Set(rows.map(scopeOf))) {
      try {
        await this.browse(scope, ctx);
        allowed.set(scope, true);
      } catch (error) {
        if (!(error instanceof AppException)) throw error;
        allowed.set(scope, false);
      }
    }
    const namesByScope = new Map<string, string[]>();
    for (const row of rows) {
      if (typeof row.values.name !== 'string') continue;
      const scope = scopeOf(row);
      namesByScope.set(scope, [...(namesByScope.get(scope) ?? []), row.values.name]);
    }
    const taken = new Map<string, TagRow[]>();
    for (const [scope, names] of namesByScope) {
      if (allowed.get(scope)) taken.set(scope, await this.repo.findByNames(scope, names));
    }
    for (const row of rows) {
      const scope = scopeOf(row);
      if (!allowed.get(scope)) {
        push(row.rowNo, {
          column: mode === 'create' ? 'scope' : null,
          code: 'forbidden',
          severity: 'error',
        });
        continue;
      }
      const name = row.values.name;
      if (typeof name !== 'string') continue;
      const clash = (taken.get(scope) ?? []).find(
        (tag) => tag.name.toLowerCase() === name.toLowerCase() && tag.id !== row.target?.id,
      );
      if (clash) {
        push(row.rowNo, {
          column: 'name',
          code: 'alreadyExists',
          params: { value: name },
          severity: 'error',
        });
      }
    }
    return issues;
  }
}
