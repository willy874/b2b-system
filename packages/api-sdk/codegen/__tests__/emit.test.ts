import { describe, expect, it } from 'vitest';

import { emitTsType } from '../emit-ts';
import { emitZod } from '../emit-zod';
import { camelCase, kebabCase, pascalCase } from '../naming';
import { toNode } from '../schema-node';
import type { OpenApiDocument, SchemaObject } from '../spec';

const document = {
  openapi: '3.1.0',
  info: { title: 't', version: '0' },
  paths: {},
} as OpenApiDocument;

function node(schema: unknown) {
  return toNode(schema as SchemaObject, { document, warnings: [] });
}

const ts = (schema: unknown) => emitTsType(node(schema), { typeName: (name) => name });
const zod = (schema: unknown) =>
  emitZod(node(schema), { schemaName: (name) => `${name}Schema`, isLazy: () => false });

describe('naming', () => {
  it.each([
    ['UserController_list', 'userControllerList', 'UserControllerList', 'user-controller-list'],
    ['get /users/{id}', 'getUsersId', 'GetUsersId', 'get-users-id'],
    ['audit-logs', 'auditLogs', 'AuditLogs', 'audit-logs'],
    ['HTTPStatus', 'httpStatus', 'HttpStatus', 'http-status'],
  ])('%s → %s / %s / %s', (input, camel, pascal, kebab) => {
    expect(camelCase(input)).toBe(camel);
    expect(pascalCase(input)).toBe(pascal);
    expect(kebabCase(input)).toBe(kebab);
  });

  it('保留字加底線、數字開頭加前綴', () => {
    expect(camelCase('delete')).toBe('delete_');
    expect(pascalCase('2fa')).toBe('_2fa');
  });
});

describe('TS 型別輸出', () => {
  it.each([
    ['3.0 nullable', { type: 'string', nullable: true }, 'string | null'],
    ['3.1 type 陣列含 null', { type: ['string', 'null'] }, 'string | null'],
    [
      '3.1 oneOf 含 null',
      { oneOf: [{ $ref: '#/components/schemas/User' }, { type: 'null' }] },
      'User | null',
    ],
    ['多型別', { type: ['string', 'integer'] }, 'string | number'],
    ['enum', { type: 'string', enum: ['a', 'b'] }, '"a" | "b"'],
    ['const', { const: 1 }, '1'],
    ['binary', { type: 'string', format: 'binary' }, 'Blob'],
    [
      '陣列的元素是聯集',
      { type: 'array', items: { type: ['string', 'null'] } },
      'Array<string | null>',
    ],
    [
      '記錄',
      { type: 'object', additionalProperties: { type: 'number' } },
      'Record<string, number>',
    ],
    [
      '交集內的可空成員加括號',
      {
        allOf: [{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }],
        nullable: true,
      },
      '(A & B) | null',
    ],
  ])('%s', (_, schema, expected) => {
    expect(ts(schema)).toBe(expected);
  });

  it('選填欄位加 ?、非識別字的鍵加引號、有描述時帶 JSDoc', () => {
    expect(
      ts({
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
          'x-trace': { type: 'string', description: '追蹤碼' },
        },
      }),
    ).toBe('{\nid: string;\n/** 追蹤碼 */\n"x-trace"?: string;\n}');
  });
});

describe('zod 輸出', () => {
  it.each([
    [
      'format 對應專屬 builder',
      { type: 'string', format: 'email', maxLength: 5 },
      'z.email().max(5)',
    ],
    ['未知 format 退回 z.string()', { type: 'string', format: 'hostname' }, 'z.string()'],
    [
      'pattern 以 RegExp 字串輸出',
      { type: 'string', pattern: '^a\\d$' },
      'z.string().regex(new RegExp("^a\\\\d$"))',
    ],
    [
      '3.0 exclusiveMinimum 布林',
      { type: 'integer', minimum: 0, exclusiveMinimum: true },
      'z.int().gt(0)',
    ],
    [
      '3.1 exclusiveMinimum 數值',
      { type: 'number', exclusiveMinimum: 0, maximum: 9 },
      'z.number().max(9).gt(0)',
    ],
    ['字串 enum', { enum: ['a', 'b'] }, 'z.enum(["a", "b"])'],
    ['混合 enum', { enum: [1, 'a'] }, 'z.union([z.literal(1), z.literal("a")])'],
    [
      '3.0 nullable enum（null 放在 enum 裡）',
      { type: 'string', enum: ['a', null], nullable: true },
      'z.enum(["a"]).nullable()',
    ],
    ['預設值', { type: 'boolean', default: false }, 'z.boolean().default(false)'],
    ['ref', { $ref: '#/components/schemas/User' }, 'UserSchema'],
    ['記錄', { type: 'object', additionalProperties: true }, 'z.record(z.string(), z.unknown())'],
  ])('%s', (_, schema, expected) => {
    expect(zod(schema)).toBe(expected);
  });

  it('選填欄位 .optional()；有預設值的不再加', () => {
    expect(
      zod({
        type: 'object',
        required: ['a'],
        properties: {
          a: { type: 'string' },
          b: { type: 'string' },
          c: { type: 'integer', default: 1 },
        },
      }),
    ).toBe('z.object({\na: z.string(),\nb: z.string().optional(),\nc: z.int().default(1),\n})');
  });

  it('有具名欄位又允許額外鍵時用 catchall', () => {
    expect(
      zod({
        type: 'object',
        properties: { a: { type: 'string' } },
        additionalProperties: { type: 'number' },
      }),
    ).toBe('z.object({\na: z.string().optional(),\n}).catchall(z.number())');
  });

  it('循環引用包 z.lazy', () => {
    const expression = emitZod(node({ $ref: '#/components/schemas/Tree' }), {
      schemaName: (name) => `${name}Schema`,
      isLazy: () => true,
    });
    expect(expression).toBe('z.lazy(() => TreeSchema)');
  });
});
