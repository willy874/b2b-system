import { vi } from 'vitest';
import { z } from 'zod';
import type { ZodError } from 'zod';

import type { PermissionKey } from '@/common/types';
import { AppException } from '@/core/errors';

import { REFERENCE_SEARCH_LIMIT } from '../data-transfer.constants';
import type {
  AnyTransferResource,
  MatchResult,
  ResolvedReference,
  TransferColumn,
  TransferContext,
  TransferImporter,
} from '../data-transfer.types';
import { hasErrors, ImportValidator, zodIssue } from '../import/import-validator';
import type { ImportRowInput, ValidatedRow } from '../import/import-validator';
import { isSameFileRef } from '../import/same-file';

const SPEC = 'docs/architecture/backend/22-data-transfer.md';

function context(granted: readonly string[] = []): TransferContext {
  const keys = new Set(granted);
  return {
    actor: { id: 'user-1', email: 'owner@example.com', status: 'active' },
    locale: 'zh-TW',
    timezone: 'Asia/Taipei',
    signal: new AbortController().signal,
    can: (key: PermissionKey) => keys.has(key),
  };
}

type Column = TransferColumn<unknown>;

function column(key: string, overrides: Partial<Column> = {}): Column {
  return {
    key,
    label: { 'zh-TW': key, 'en-US': key },
    kind: 'string',
    export: { get: (record) => (record as Record<string, unknown>)[key] },
    import: { modes: ['create', 'update'], schema: z.string() },
    ...overrides,
  };
}

function resource(columns: Column[], importer: TransferImporter<unknown> = { modes: {} }) {
  return {
    type: 'widget',
    fileBaseName: 'widgets',
    label: { 'zh-TW': '小工具', 'en-US': 'Widgets' },
    columns,
    importer,
  } satisfies AnyTransferResource;
}

function input(rowNo: number, cells: Record<string, string>, extra: Partial<ImportRowInput> = {}) {
  return { rowNo, cells, ...extra };
}

function target(
  id: string,
  record: Record<string, unknown>,
  extra: Partial<MatchResult<unknown>> = {},
) {
  return { id, label: `label-${id}`, version: 3, record, ...extra };
}

/** 參照欄：名稱 → id 的對照；`ambiguous` 的名稱回傳同名多筆。 */
function referenceColumn(
  key: string,
  known: Record<string, ResolvedReference>,
  overrides: Partial<Column> = {},
  candidates: readonly { id: string; label: string }[] = [],
) {
  const resolve = vi.fn(async (names: readonly string[]) => {
    const map = new Map<string, ResolvedReference>();
    for (const name of names) {
      const match = known[name.toLowerCase()];
      if (match) map.set(name.toLowerCase(), match);
    }
    return map;
  });
  const search = vi.fn(async () => candidates);
  return {
    column: column(key, { kind: 'reference', reference: { resolve, search }, ...overrides }),
    resolve,
    search,
  };
}

const fakeZodError = (issues: unknown[]) => ({ issues }) as unknown as ZodError;

/** 部門式的資源：parent 可以引用檔案裡另一列的 code。 */
function orgResource() {
  const code = column('code', { import: { modes: ['create'], schema: z.string() } });
  const { column: parent } = referenceColumn('parent', { hq: { id: 'org-hq', label: 'HQ' } });
  const reference = parent.reference;
  if (!reference) throw new Error('parent 應該有 reference');
  return resource([code, { ...parent, reference: { ...reference, sameFile: { column: 'code' } } }]);
}

const validator = new ImportValidator();

describe(`hasErrors（${SPEC} §7.4）`, () => {
  it.each([
    [[], false],
    [[{ column: null, code: 'noChanges', severity: 'warning' as const }], false],
    [[{ column: 'name', code: 'required', severity: 'error' as const }], true],
  ])('只有 severity 為 error 的問題才算錯誤（%#）', (issues, expected) => {
    expect(hasErrors({ issues })).toBe(expected);
  });
});

describe(`zodIssue（${SPEC} §7.4）`, () => {
  it.each([
    ['字串太短', z.string().min(3), 'ab', { code: 'tooShort', params: { min: 3 } }],
    ['數字太小', z.number().min(5), 1, { code: 'tooSmall', params: { min: 5 } }],
    ['字串太長', z.string().max(2), 'abc', { code: 'tooLong', params: { max: 2 } }],
    ['數字太大', z.number().max(5), 9, { code: 'tooLarge', params: { max: 5 } }],
    ['格式不符', z.email(), 'nope', { code: 'invalidFormat', params: { format: 'email' } }],
    ['型別不符', z.string(), 5, { code: 'invalidFormat' }],
  ])('%s 對應成對應的問題代碼', (_name, schema, value, expected) => {
    const result = schema.safeParse(value);
    if (result.success) throw new Error('應該驗證失敗');
    expect(zodIssue('name', result.error)).toEqual({
      column: 'name',
      severity: 'error',
      ...expected,
    });
  });

  it.each([
    ['沒有 issue', [], { code: 'invalidFormat' }],
    ['too_small 沒有 minimum', [{ code: 'too_small' }], { code: 'tooSmall', params: { min: 0 } }],
    ['too_big 沒有 maximum', [{ code: 'too_big' }], { code: 'tooLarge', params: { max: 0 } }],
    [
      'invalid_format 沒有 format',
      [{ code: 'invalid_format' }],
      { code: 'invalidFormat', params: { format: 'text' } },
    ],
  ])('%s 時有預設值', (_name, issues, expected) => {
    expect(zodIssue('name', fakeZodError(issues))).toEqual({
      column: 'name',
      severity: 'error',
      ...expected,
    });
  });
});

describe(`ImportValidator.validate：欄位與型別（${SPEC} §7.4）`, () => {
  it('出現不能匯入或沒有權限的欄位時拋 DATA_TRANSFER_MAPPING_INVALID', async () => {
    const secret = column('secret', {
      import: {
        modes: ['create'],
        schema: z.string(),
        permission: 'widget:secret' as PermissionKey,
      },
    });
    const promise = validator.validate(
      resource([column('name'), secret]),
      'create',
      [input(1, { name: 'a', secret: 'x' })],
      context(),
    );
    await expect(promise).rejects.toBeInstanceOf(AppException);
    await expect(promise).rejects.toMatchObject({
      code: 'DATA_TRANSFER_MAPPING_INVALID',
      details: { column: 'secret' },
    });
  });

  it('有填的欄位轉成值與文字；空白的欄位不出現', async () => {
    const [row] = await validator.validate(
      resource([
        column('name'),
        column('age', { kind: 'number', import: { modes: ['create'], schema: z.number() } }),
      ]),
      'create',
      [input(1, { name: ' Alice ', age: '' })],
      context(),
    );
    expect(row).toEqual({
      rowNo: 1,
      issues: [],
      values: { name: 'Alice' },
      texts: { name: 'Alice' },
    });
  });

  it('轉換失敗的儲存格標出 parseCell 的問題代碼', async () => {
    const [row] = await validator.validate(
      resource([
        column('age', { kind: 'number', import: { modes: ['create'], schema: z.number() } }),
      ]),
      'create',
      [input(1, { age: 'abc' })],
      context(),
    );
    expect(row?.issues).toEqual([{ column: 'age', code: 'invalidNumber', severity: 'error' }]);
    expect(row?.values).toEqual({});
  });

  it('schema 不通過時標出 Zod 對應的問題，多值欄位任一項不通過就整欄失敗', async () => {
    const tags = column('tags', {
      multiple: {},
      import: { modes: ['create'], schema: z.string().min(2) },
    });
    const [row] = await validator.validate(
      resource([tags]),
      'create',
      [input(1, { tags: 'ok;x' })],
      context(),
    );
    expect(row?.issues).toEqual([
      { column: 'tags', code: 'tooShort', params: { min: 2 }, severity: 'error' },
    ]);
    expect(row?.values).toEqual({});
  });

  it('多值欄位全部通過時值是陣列、文字以分號串接', async () => {
    const tags = column('tags', {
      multiple: {},
      import: { modes: ['create'], schema: z.string() },
    });
    const [row] = await validator.validate(
      resource([tags]),
      'create',
      [input(1, { tags: 'a; b' })],
      context(),
    );
    expect(row?.values).toEqual({ tags: ['a', 'b'] });
    expect(row?.texts).toEqual({ tags: 'a;b' });
  });

  it('新增模式的 \\N 視同沒填', async () => {
    const [row] = await validator.validate(
      resource([column('name')]),
      'create',
      [input(1, { name: '\\N' })],
      context(),
    );
    expect(row).toMatchObject({ issues: [], values: {} });
  });

  it('必填欄沒有值時標 required；同一欄已經有問題時不重複標', async () => {
    const name = column('name', {
      import: { modes: ['create'], requiredOnCreate: true, schema: z.string() },
    });
    const age = column('age', {
      kind: 'number',
      import: { modes: ['create'], requiredOnCreate: true, schema: z.number() },
    });
    const [row] = await validator.validate(
      resource([name, age]),
      'create',
      [input(1, { age: 'x' })],
      context(),
    );
    expect(row?.issues).toEqual([
      { column: 'age', code: 'invalidNumber', severity: 'error' },
      { column: 'name', code: 'required', severity: 'error' },
    ]);
  });
});

describe(`ImportValidator.validate：參照（${SPEC} §7.4、D7）`, () => {
  it('完全相符的名稱解析成 id，文字記解析後的名稱；多值去重', async () => {
    const { column: roles } = referenceColumn(
      'roles',
      { admin: { id: 'r1', label: 'Admin' }, root: { id: 'r1', label: 'Admin' } },
      { multiple: {} },
    );
    const [row] = await validator.validate(
      resource([roles]),
      'create',
      [input(1, { roles: 'admin;root' })],
      context(),
    );
    expect(row?.values).toEqual({ roles: ['r1'] });
    expect(row?.texts).toEqual({ roles: 'Admin;Admin' });
  });

  it('單一值的參照存成單一 id', async () => {
    const { column: owner } = referenceColumn('owner', { alice: { id: 'u1', label: 'Alice' } });
    const [row] = await validator.validate(
      resource([owner]),
      'create',
      [input(1, { owner: 'alice' })],
      context(),
    );
    expect(row?.values).toEqual({ owner: 'u1' });
  });

  it('找不到時標 referenceNotFound 並附上最接近的候選，同一個名稱只查一次', async () => {
    const { column: owner, search } = referenceColumn('owner', {}, {}, [
      { id: 'u1', label: 'Alice' },
    ]);
    const rows = await validator.validate(
      resource([owner]),
      'create',
      [input(1, { owner: 'Alise' }), input(2, { owner: 'Alise' })],
      context(),
    );
    for (const row of rows) {
      expect(row.issues).toEqual([
        {
          column: 'owner',
          code: 'referenceNotFound',
          params: { value: 'Alise', suggestion: 'Alice' },
          severity: 'error',
        },
      ]);
      expect(row.values).toEqual({});
    }
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('Al', expect.anything());
  });

  it('沒有夠接近的候選時不附 suggestion', async () => {
    const { column: owner } = referenceColumn('owner', {}, {}, [{ id: 'u1', label: 'Zzzzzz' }]);
    const [row] = await validator.validate(
      resource([owner]),
      'create',
      [input(1, { owner: 'Alice' })],
      context(),
    );
    expect(row?.issues).toEqual([
      { column: 'owner', code: 'referenceNotFound', params: { value: 'Alice' }, severity: 'error' },
    ]);
  });

  it(`找不到的名稱超過 ${REFERENCE_SEARCH_LIMIT} 個之後不再查候選`, async () => {
    const { column: owner, search } = referenceColumn('owner', {}, {}, [{ id: 'u1', label: 'x' }]);
    const inputs = Array.from({ length: REFERENCE_SEARCH_LIMIT + 3 }, (_, index) =>
      input(index + 1, { owner: `missing-${index}` }),
    );
    const rows = await validator.validate(resource([owner]), 'create', inputs, context());
    expect(search).toHaveBeenCalledTimes(REFERENCE_SEARCH_LIMIT);
    expect(rows.every((row) => row.issues[0]?.code === 'referenceNotFound')).toBe(true);
  });

  it('同名多筆時標 ambiguousReference', async () => {
    const { column: owner } = referenceColumn('owner', { alice: 'ambiguous' });
    const [row] = await validator.validate(
      resource([owner]),
      'create',
      [input(1, { owner: 'alice' })],
      context(),
    );
    expect(row?.issues).toEqual([
      {
        column: 'owner',
        code: 'ambiguousReference',
        params: { value: 'alice' },
        severity: 'error',
      },
    ]);
    expect(row?.values).toEqual({});
  });

  it('參照欄沒有 reference 定義時保留原本的名稱', async () => {
    const owner = column('owner', { kind: 'reference' });
    const [row] = await validator.validate(
      resource([owner]),
      'create',
      [input(1, { owner: 'alice' })],
      context(),
    );
    expect(row?.values).toEqual({ owner: 'alice' });
  });

  it('修改模式清空（\\N）的參照不解析', async () => {
    const { column: owner, resolve } = referenceColumn(
      'owner',
      {},
      {
        import: { modes: ['update'], nullable: true, schema: z.string() },
      },
    );
    const id = column('id', { import: { modes: ['update'], matchKey: 1, schema: z.string() } });
    const [row] = await validator.validate(
      resource([id, owner]),
      'update',
      [input(1, { id: 'x', owner: '\\N' })],
      context(),
    );
    expect(row?.values).toEqual({ id: 'x', owner: null });
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe(`ImportValidator.validate：同一份檔案內的引用（${SPEC} §7.8）`, () => {
  it('資料庫沒有、檔案裡有的值換成佔位值', async () => {
    const rows = await validator.validate(
      orgResource(),
      'create',
      [input(1, { code: 'a', parent: 'b' }), input(2, { code: 'b', parent: 'HQ' })],
      context(),
    );
    expect(rows[0]?.issues).toEqual([]);
    expect(isSameFileRef(rows[0]?.values.parent)).toBe(true);
    expect(rows[0]?.texts.parent).toBe('b');
    expect(rows[1]?.values.parent).toBe('org-hq');
  });

  it('預覽帶來的 fileKeys 也算檔案裡有的值', async () => {
    const [row] = await validator.validate(
      orgResource(),
      'create',
      [input(1, { code: 'a', parent: 'c' })],
      context(),
      { fileKeys: { code: ['C'] } },
    );
    expect(row?.issues).toEqual([]);
    expect(isSameFileRef(row?.values.parent)).toBe(true);
  });

  it('互相引用與引用自己的列標 referenceCycle 並移除佔位值', async () => {
    const rows = await validator.validate(
      orgResource(),
      'create',
      [
        input(1, { code: 'a', parent: 'b' }),
        input(2, { code: 'b', parent: 'a' }),
        input(3, { code: 'c', parent: 'c' }),
      ],
      context(),
    );
    for (const row of rows) {
      expect(row.issues).toEqual([
        {
          column: 'parent',
          code: 'referenceCycle',
          params: { value: expect.any(String) },
          severity: 'error',
        },
      ]);
      expect(row.values.parent).toBeUndefined();
    }
  });
});

describe(`ImportValidator.validate：新增模式的資料庫重複（${SPEC} §7.4）`, () => {
  it('唯一欄已存在時標 alreadyExists；沒有值的唯一欄不查詢', async () => {
    const findExisting = vi.fn(async (_column: string, values: readonly string[]) => {
      expect(values).toEqual(['taken@example.com', 'free@example.com']);
      return new Set(['taken@example.com']);
    });
    const rows = await validator.validate(
      resource([column('email'), column('code')], {
        modes: {},
        uniqueColumns: ['email', 'code'],
        findExisting,
      }),
      'create',
      [input(1, { email: 'Taken@example.com' }), input(2, { email: 'free@example.com' })],
      context(),
    );
    expect(findExisting).toHaveBeenCalledTimes(1);
    expect(rows[0]?.issues).toEqual([
      {
        column: 'email',
        code: 'alreadyExists',
        params: { value: 'Taken@example.com' },
        severity: 'error',
      },
    ]);
    expect(rows[1]?.issues).toEqual([]);
  });

  it('資源沒有 findExisting 時不檢查', async () => {
    const [row] = await validator.validate(
      resource([column('email')], { modes: {}, uniqueColumns: ['email'] }),
      'create',
      [input(1, { email: 'a@example.com' })],
      context(),
    );
    expect(row?.issues).toEqual([]);
  });
});

describe(`ImportValidator.validate：修改模式的比對（${SPEC} §7.5）`, () => {
  const ID = column('id', { import: { modes: ['update'], matchKey: 1, schema: z.string() } });
  const EMAIL = column('email', { import: { modes: ['update'], matchKey: 2, schema: z.string() } });
  const NAME = column('name', {
    import: { modes: ['update'], nullable: true, schema: z.string() },
  });
  const STATUS = column('status', {
    import: {
      modes: ['update'],
      schema: z.string(),
      transitions: { active: ['disabled'], disabled: [] },
    },
  });
  const TAGS = column('tags', { multiple: {}, import: { modes: ['update'], schema: z.string() } });
  const NOTE = column('note', {
    export: undefined,
    import: { modes: ['update'], schema: z.string() },
  });

  function setup(
    found: Record<string, Record<string, MatchResult<unknown>[]>> = {},
    manual?: Record<string, MatchResult<unknown>>,
  ) {
    const resolveTargets = vi.fn(async (key: string) => new Map(Object.entries(found[key] ?? {})));
    const findTargetsById = manual
      ? vi.fn(async (ids: readonly string[]) => {
          const map = new Map<string, MatchResult<unknown>>();
          for (const id of ids) if (manual[id]) map.set(id, manual[id]);
          return map;
        })
      : undefined;
    const importer: TransferImporter<unknown> = {
      modes: {},
      resolveTargets,
      ...(findTargetsById ? { findTargetsById } : {}),
    };
    return {
      res: resource([ID, EMAIL, NAME, STATUS, TAGS, NOTE], importer),
      resolveTargets,
      findTargetsById,
    };
  }

  it('資源沒有 resolveTargets 時不比對', async () => {
    const [row] = await validator.validate(
      resource([ID, NAME]),
      'update',
      [input(1, { id: 'x', name: 'n' })],
      context(),
    );
    expect(row?.target).toBeUndefined();
    expect(row?.issues).toEqual([]);
  });

  it('撤回比對（targetId 為 null）標 targetNotSelected', async () => {
    const { res, resolveTargets } = setup();
    const [row] = await validator.validate(
      res,
      'update',
      [input(1, { email: 'a@example.com' }, { targetId: null })],
      context(),
    );
    expect(row?.issues).toEqual([{ column: null, code: 'targetNotSelected', severity: 'error' }]);
    expect(resolveTargets).not.toHaveBeenCalled();
  });

  it('沒有填任何比對鍵時標 matchKeyRequired', async () => {
    const { res } = setup();
    const [row] = await validator.validate(res, 'update', [input(1, { name: 'n' })], context());
    expect(row?.issues).toEqual([{ column: null, code: 'matchKeyRequired', severity: 'error' }]);
  });

  it('id 有填就只用 id 比對，找不到是 targetNotFound', async () => {
    const { res, resolveTargets } = setup({ id: {} });
    const [row] = await validator.validate(
      res,
      'update',
      [input(1, { id: ' ABC ', email: 'a@example.com' })],
      context(),
    );
    expect(resolveTargets).toHaveBeenCalledExactlyOnceWith('id', ['abc'], expect.anything());
    expect(row?.issues).toEqual([
      { column: 'id', code: 'targetNotFound', params: { value: 'abc' }, severity: 'error' },
    ]);
  });

  it('比對鍵本身有問題時不再比對', async () => {
    const strict = column('id', { import: { modes: ['update'], matchKey: 1, schema: z.uuid() } });
    const resolveTargets = vi.fn(async () => new Map());
    const [row] = await validator.validate(
      resource([strict], { modes: {}, resolveTargets }),
      'update',
      [input(1, { id: 'not-uuid' })],
      context(),
    );
    expect(resolveTargets).not.toHaveBeenCalled();
    expect(row?.issues.map((issue) => issue.code)).toEqual(['invalidFormat']);
  });

  it('命中多筆時標 ambiguousMatch', async () => {
    const { res } = setup({
      email: { 'a@example.com': [target('u1', {}), target('u2', {})] },
    });
    const [row] = await validator.validate(
      res,
      'update',
      [input(1, { email: 'a@example.com' })],
      context(),
    );
    expect(row?.issues).toEqual([
      {
        column: 'email',
        code: 'ambiguousMatch',
        params: { value: 'a@example.com', count: 2 },
        severity: 'error',
      },
    ]);
  });

  it('比對成功：記下目前值與有變更的欄位，比對鍵與沒有 export 的欄不算變更', async () => {
    const record = { email: 'a@example.com', name: 'Old', tags: ['x', 'y'] };
    const { res } = setup({ email: { 'a@example.com': [target('u1', record)] } });
    const [row] = await validator.validate(
      res,
      'update',
      [input(1, { email: 'a@example.com', name: 'New', tags: 'y;x', note: 'memo' })],
      context(),
    );
    expect(row).toMatchObject({
      issues: [],
      target: { id: 'u1' },
      current: { email: 'a@example.com', name: 'Old', tags: 'x;y' },
      changed: ['name'],
      // 多值不計順序：與目前值相同，不送出
      values: { email: 'a@example.com', name: 'New', note: 'memo' },
    });
    expect(row?.texts.tags).toBeUndefined();
  });

  it('所有欄都與目前值相同時加上 noChanges 警告', async () => {
    const { res } = setup({
      email: { 'a@example.com': [target('u1', { email: 'a@example.com', name: 'Same' })] },
    });
    const [row] = await validator.validate(
      res,
      'update',
      [input(1, { email: 'a@example.com', name: 'Same' })],
      context(),
    );
    expect(row?.changed).toEqual([]);
    expect(row?.issues).toEqual([{ column: null, code: 'noChanges', severity: 'warning' }]);
  });

  it('\\N 清空：可清空的欄位值為 null，不可清空的標 notNullable', async () => {
    const { res } = setup({
      email: { 'a@example.com': [target('u1', { name: 'Old', status: 'active' })] },
    });
    const [row] = await validator.validate(
      res,
      'update',
      [input(1, { email: 'a@example.com', name: '\\N', status: '\\N' })],
      context(),
    );
    expect(row?.values.name).toBeNull();
    expect(row?.issues).toEqual([{ column: 'status', code: 'notNullable', severity: 'error' }]);
  });

  it.each([
    ['active', 'disabled', true],
    ['disabled', 'active', false],
    [undefined, 'active', false],
  ])('狀態轉移 %s → %s 是否允許：%s', async (from, to, allowed) => {
    const { res } = setup({ email: { 'a@example.com': [target('u1', { status: from })] } });
    const [row] = await validator.validate(
      res,
      'update',
      [input(1, { email: 'a@example.com', status: to })],
      context(),
    );
    if (allowed) {
      expect(row?.changed).toEqual(['status']);
      expect(row?.issues).toEqual([]);
    } else {
      expect(row?.changed).toEqual([]);
      expect(row?.issues).toEqual([
        {
          column: 'status',
          code: 'transitionNotAllowed',
          params: { from: from ?? '', to },
          severity: 'error',
        },
      ]);
    }
  });

  it('手動指定的目標以 id 查，找不到標 targetNotFound', async () => {
    const { res, findTargetsById, resolveTargets } = setup(
      {},
      {
        u1: target('u1', { name: 'Old' }),
      },
    );
    const rows = await validator.validate(
      res,
      'update',
      [
        input(1, { email: 'whatever', name: 'New' }, { targetId: 'u1' }),
        input(2, { name: 'New' }, { targetId: 'gone' }),
      ],
      context(),
    );
    expect(findTargetsById).toHaveBeenCalledExactlyOnceWith(['u1', 'gone'], expect.anything());
    expect(resolveTargets).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ target: { id: 'u1' }, changed: ['name'], issues: [] });
    expect(rows[1]?.issues).toEqual([
      { column: null, code: 'targetNotFound', params: { value: 'gone' }, severity: 'error' },
    ]);
  });

  it('資源不支援手動指定時，手動指定的目標都找不到', async () => {
    const { res } = setup();
    const [row] = await validator.validate(
      res,
      'update',
      [input(1, { name: 'New' }, { targetId: 'u1' })],
      context(),
    );
    expect(row?.issues).toEqual([
      { column: null, code: 'targetNotFound', params: { value: 'u1' }, severity: 'error' },
    ]);
  });
});

describe(`ImportValidator.validate：資源特有的規則與跨列檢查（${SPEC} §7.4、D23）`, () => {
  it('validateRows 只收到沒有錯誤的列，回傳的問題併入對應的列', async () => {
    const validateRows = vi.fn(
      async () => new Map([[2, [{ column: 'name', code: 'custom', severity: 'error' as const }]]]),
    );
    const age = column('age', {
      kind: 'number',
      import: { modes: ['create'], schema: z.number() },
    });
    const rows = await validator.validate(
      resource([column('name'), age], { modes: {}, validateRows }),
      'create',
      [input(1, { age: 'bad' }), input(2, { name: 'ok' })],
      context(),
    );
    expect(validateRows).toHaveBeenCalledExactlyOnceWith(
      'create',
      [{ rowNo: 2, values: { name: 'ok' }, target: undefined, changed: undefined }],
      expect.anything(),
    );
    expect(rows[1]?.issues).toEqual([{ column: 'name', code: 'custom', severity: 'error' }]);
  });

  it('每一列都有錯誤時不呼叫 validateRows', async () => {
    const validateRows = vi.fn(async () => new Map());
    const age = column('age', {
      kind: 'number',
      import: { modes: ['create'], schema: z.number() },
    });
    await validator.validate(
      resource([age], { modes: {}, validateRows }),
      'create',
      [input(1, { age: 'bad' })],
      context(),
    );
    expect(validateRows).not.toHaveBeenCalled();
  });

  it('crossRow：唯一欄在檔案內重複的列標 duplicateInFile，空白不算', async () => {
    const rows = await validator.validate(
      resource([column('email')], { modes: {}, uniqueColumns: ['email'] }),
      'create',
      [
        input(1, { email: 'A@example.com' }),
        input(2, { email: ' a@example.com' }),
        input(3, { email: '' }),
        input(4, {}),
      ],
      context(),
      { crossRow: true },
    );
    expect(rows.map((row) => row.issues)).toEqual([
      [{ column: 'email', code: 'duplicateInFile', params: { rows: [1, 2] }, severity: 'error' }],
      [{ column: 'email', code: 'duplicateInFile', params: { rows: [1, 2] }, severity: 'error' }],
      [],
      [],
    ]);
  });

  it('沒有 crossRow 時不檢查檔案內重複', async () => {
    const rows = await validator.validate(
      resource([column('email')], { modes: {}, uniqueColumns: ['email'] }),
      'create',
      [input(1, { email: 'a' }), input(2, { email: 'a' })],
      context(),
    );
    expect(rows.flatMap((row) => row.issues)).toEqual([]);
  });

  it('crossRow 的修改模式：同一個目標出現多次標 duplicateTarget', async () => {
    const ID = column('id', { import: { modes: ['update'], matchKey: 1, schema: z.string() } });
    const NAME = column('name', { import: { modes: ['update'], schema: z.string() } });
    const resolveTargets = vi.fn(async () => new Map([['u1', [target('u1', { name: 'Old' })]]]));
    const rows = await validator.validate(
      resource([ID, NAME], { modes: {}, resolveTargets }),
      'update',
      [
        input(1, { id: 'u1', name: 'A' }),
        input(2, { id: 'u1', name: 'B' }),
        input(3, { name: 'C' }),
      ],
      context(),
      { crossRow: true },
    );
    expect(rows[0]?.issues).toEqual([
      { column: null, code: 'duplicateTarget', params: { rows: [1, 2] }, severity: 'error' },
    ]);
    expect(rows[1]?.issues).toEqual(rows[0]?.issues);
    expect(rows[2]?.issues).toEqual([
      { column: null, code: 'matchKeyRequired', severity: 'error' },
    ]);
  });
});

describe(`ImportValidator.toResponse（${SPEC} §7.4、§7.5）`, () => {
  const base: ValidatedRow = { rowNo: 1, issues: [], values: {}, texts: {} };

  it('沒有目標時只回傳列號與問題', () => {
    expect(validator.toResponse(base)).toEqual({ rowNo: 1, issues: [] });
  });

  it('有目標時附上目標、目前值與變更的欄位，含關聯欄的 expected', () => {
    const response = validator.toResponse({
      ...base,
      target: target('u1', {}, { expected: { roleIds: ['r1'] } }),
      current: { name: 'Old' },
      changed: ['name'],
    });
    expect(response).toEqual({
      rowNo: 1,
      issues: [],
      target: {
        id: 'u1',
        label: 'label-u1',
        version: 3,
        current: { name: 'Old' },
        expected: { roleIds: ['r1'] },
      },
      changed: ['name'],
    });
  });

  it('沒有 expected 與 changed 時不附 expected、changed 為空陣列', () => {
    const response = validator.toResponse({ ...base, target: target('u1', {}), current: {} });
    expect(response).toEqual({
      rowNo: 1,
      issues: [],
      target: { id: 'u1', label: 'label-u1', version: 3, current: {} },
      changed: [],
    });
  });
});
