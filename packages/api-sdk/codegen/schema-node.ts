import { SCHEMA_REF_PREFIX, isRef, resolvePointer } from './spec';
import type { OpenApiDocument, ReferenceObject, SchemaObject } from './spec';

/**
 * 產生器的中介表示。TS 型別與 zod schema 都從這裡輸出，
 * 3.0 / 3.1 的差異（`nullable`、`type: [..., 'null']`、`exclusiveMinimum` 布林或數字）只在這一層處理。
 */
export type SchemaNode =
  | RefNode
  | StringNode
  | NumberNode
  | BooleanNode
  | NullNode
  | EnumNode
  | ArrayNode
  | ObjectNode
  | UnionNode
  | IntersectionNode
  | UnknownNode;

export interface NodeMeta {
  nullable?: boolean;
  description?: string;
  deprecated?: boolean;
  /** 有值時 `hasDefault` 為 true；`default: null` 也是合法預設值，所以不能只看 `defaultValue`。 */
  hasDefault?: boolean;
  defaultValue?: unknown;
}

export interface RefNode extends NodeMeta {
  kind: 'ref';
  /** `components.schemas` 裡的原始名稱 */
  name: string;
}

export interface StringNode extends NodeMeta {
  kind: 'string';
  format?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

export interface NumberNode extends NodeMeta {
  kind: 'number';
  integer: boolean;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
}

export interface BooleanNode extends NodeMeta {
  kind: 'boolean';
}

export interface NullNode extends NodeMeta {
  kind: 'null';
}

export type EnumValue = string | number | boolean | null;

export interface EnumNode extends NodeMeta {
  kind: 'enum';
  values: EnumValue[];
}

export interface ArrayNode extends NodeMeta {
  kind: 'array';
  items: SchemaNode;
  minItems?: number;
  maxItems?: number;
}

export interface ObjectProperty {
  name: string;
  node: SchemaNode;
  required: boolean;
}

export interface ObjectNode extends NodeMeta {
  kind: 'object';
  properties: ObjectProperty[];
  /** `false`：不允許額外鍵；`true`：允許任意值；`SchemaNode`：額外鍵的值型別 */
  additional: boolean | SchemaNode;
}

export interface UnionNode extends NodeMeta {
  kind: 'union';
  members: SchemaNode[];
}

export interface IntersectionNode extends NodeMeta {
  kind: 'intersection';
  members: SchemaNode[];
}

export interface UnknownNode extends NodeMeta {
  kind: 'unknown';
}

export interface NodeContext {
  document: OpenApiDocument;
  /** 無法完整表達的 spec 寫法；產生器照樣輸出（較寬鬆的型別），由 CLI 印出提醒 */
  warnings: string[];
}

/** openapi-types 的 3.0 / 3.1 聯集型別互不相容；這裡逐欄位自行檢查，所以用寬鬆的記錄型別讀取。 */
type AnySchema = Record<string, unknown>;

export function toNode(
  input: SchemaObject | ReferenceObject | boolean,
  ctx: NodeContext,
): SchemaNode {
  if (input === true) return { kind: 'unknown' };
  if (input === false) {
    ctx.warnings.push('schema `false` 以 unknown 表示');
    return { kind: 'unknown' };
  }
  if (isRef(input)) {
    if (
      input.$ref.startsWith(SCHEMA_REF_PREFIX) &&
      !input.$ref.slice(SCHEMA_REF_PREFIX.length).includes('/')
    ) {
      return { kind: 'ref', name: decodeURIComponent(input.$ref.slice(SCHEMA_REF_PREFIX.length)) };
    }
    // 指到 schema 內部（例：`#/components/schemas/A/properties/b`）：直接展開
    return toNode(resolvePointer(ctx.document, input.$ref) as SchemaObject, ctx);
  }

  const schema = input as unknown as AnySchema;
  const meta = readMeta(schema);
  const node = toBareNode(schema, ctx);
  return { ...node, ...meta, nullable: Boolean(meta.nullable || node.nullable) };
}

function readMeta(schema: AnySchema): NodeMeta {
  const meta: NodeMeta = {};
  if (schema.nullable === true) meta.nullable = true;
  if (Array.isArray(schema.type) && schema.type.includes('null')) meta.nullable = true;
  if (typeof schema.description === 'string') meta.description = schema.description;
  if (schema.deprecated === true) meta.deprecated = true;
  if ('default' in schema) {
    meta.hasDefault = true;
    meta.defaultValue = schema.default;
  }
  return meta;
}

function toBareNode(schema: AnySchema, ctx: NodeContext): SchemaNode {
  if ('const' in schema) return { kind: 'enum', values: [schema.const as EnumValue] };
  if (Array.isArray(schema.enum)) {
    // 3.0 的 nullable enum 會把 null 放進 enum；拆出來交給 nullable 表達
    const values = (schema.enum as EnumValue[]).filter((value) => value !== null);
    const node: EnumNode = { kind: 'enum', values };
    if (values.length !== schema.enum.length) node.nullable = true;
    return values.length ? node : { kind: 'null' };
  }

  const composite = compositeNode(schema, ctx);
  if (composite) return composite;

  const declared: unknown[] = Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : [];
  const types = declared.filter((type) => type !== 'null');
  if (declared.length > 0 && types.length === 0) return { kind: 'null' };
  if (types.length > 1) {
    return { kind: 'union', members: types.map((type) => toBareNode({ ...schema, type }, ctx)) };
  }

  switch (types[0]) {
    case 'string':
      return stringNode(schema);
    case 'integer':
    case 'number':
      return numberNode(schema, types[0] === 'integer');
    case 'boolean':
      return { kind: 'boolean' };
    case 'array':
      return arrayNode(schema, ctx);
    case 'object':
      return objectNode(schema, ctx);
    case undefined:
      // 沒寫 type 但有 properties 的 schema 很常見，視為物件
      if (schema.properties || schema.additionalProperties !== undefined)
        return objectNode(schema, ctx);
      if (schema.items) return arrayNode(schema, ctx);
      return { kind: 'unknown' };
    default:
      ctx.warnings.push(`不認識的 type「${String(types[0])}」，以 unknown 表示`);
      return { kind: 'unknown' };
  }
}

function compositeNode(schema: AnySchema, ctx: NodeContext): SchemaNode | undefined {
  const variants = (schema.oneOf ?? schema.anyOf) as (SchemaObject | ReferenceObject)[] | undefined;
  const allOf = schema.allOf as (SchemaObject | ReferenceObject)[] | undefined;
  if (!variants && !allOf) return undefined;

  const parts: SchemaNode[] = [];
  if (allOf?.length) {
    const members = allOf.map((member) => toNode(member, ctx));
    parts.push(members.length === 1 && members[0] ? members[0] : { kind: 'intersection', members });
  }
  if (variants?.length) {
    const members = variants.map((member) => toNode(member, ctx));
    const nonNull = members.filter((member) => member.kind !== 'null');
    const union: SchemaNode =
      nonNull.length === 1 && nonNull[0] ? { ...nonNull[0] } : { kind: 'union', members: nonNull };
    // 3.1 常見寫法：`oneOf: [{ $ref }, { type: 'null' }]`
    if (nonNull.length !== members.length) union.nullable = true;
    parts.push(union);
  }
  // 與組合子並存的 properties（`allOf` 之外再補欄位）也要保留
  if (schema.properties) {
    const { allOf: _allOf, oneOf: _oneOf, anyOf: _anyOf, ...rest } = schema;
    parts.push(objectNode(rest as AnySchema, ctx));
  }
  return parts.length === 1 && parts[0] ? parts[0] : { kind: 'intersection', members: parts };
}

function stringNode(schema: AnySchema): StringNode {
  const node: StringNode = { kind: 'string' };
  if (typeof schema.format === 'string') node.format = schema.format;
  if (typeof schema.minLength === 'number') node.minLength = schema.minLength;
  if (typeof schema.maxLength === 'number') node.maxLength = schema.maxLength;
  if (typeof schema.pattern === 'string') node.pattern = schema.pattern;
  return node;
}

function numberNode(schema: AnySchema, integer: boolean): NumberNode {
  const node: NumberNode = { kind: 'number', integer };
  const { minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf } = schema;
  // 3.0：exclusiveMinimum 是布林，修飾 minimum；3.1：exclusiveMinimum 本身就是數值
  if (typeof minimum === 'number') {
    if (exclusiveMinimum === true) node.exclusiveMinimum = minimum;
    else node.minimum = minimum;
  }
  if (typeof maximum === 'number') {
    if (exclusiveMaximum === true) node.exclusiveMaximum = maximum;
    else node.maximum = maximum;
  }
  if (typeof exclusiveMinimum === 'number') node.exclusiveMinimum = exclusiveMinimum;
  if (typeof exclusiveMaximum === 'number') node.exclusiveMaximum = exclusiveMaximum;
  if (typeof multipleOf === 'number') node.multipleOf = multipleOf;
  return node;
}

function arrayNode(schema: AnySchema, ctx: NodeContext): ArrayNode {
  const items = schema.items as SchemaObject | ReferenceObject | undefined;
  if (schema.prefixItems) ctx.warnings.push('prefixItems（tuple）以一般陣列表示');
  const node: ArrayNode = {
    kind: 'array',
    items: items ? toNode(items, ctx) : { kind: 'unknown' },
  };
  if (typeof schema.minItems === 'number') node.minItems = schema.minItems;
  if (typeof schema.maxItems === 'number') node.maxItems = schema.maxItems;
  return node;
}

function objectNode(schema: AnySchema, ctx: NodeContext): ObjectNode {
  const required = new Set((schema.required as string[] | undefined) ?? []);
  const properties = Object.entries(
    (schema.properties ?? {}) as Record<string, SchemaObject | ReferenceObject>,
  ).map(([name, property]) => ({
    name,
    node: toNode(property, ctx),
    required: required.has(name),
  }));

  const raw = schema.additionalProperties as boolean | SchemaObject | ReferenceObject | undefined;
  let additional: ObjectNode['additional'];
  if (raw === undefined || raw === false) {
    // 沒寫的 additionalProperties 在 JSON Schema 裡代表「允許」，但 API 的語意幾乎都是「只有這些欄位」；
    // 這裡刻意收斂成 false，產出的型別才不會帶一個吃掉所有欄位檢查的 index signature
    additional = false;
  } else if (raw === true || (typeof raw === 'object' && Object.keys(raw).length === 0)) {
    additional = true;
  } else {
    additional = toNode(raw, ctx);
  }
  return { kind: 'object', properties, additional };
}

/** 收集 node 直接或間接引用的 component 名稱（排序與循環偵測用）。 */
export function collectRefs(node: SchemaNode, into = new Set<string>()): Set<string> {
  switch (node.kind) {
    case 'ref':
      into.add(node.name);
      break;
    case 'array':
      collectRefs(node.items, into);
      break;
    case 'object':
      for (const property of node.properties) collectRefs(property.node, into);
      if (typeof node.additional === 'object') collectRefs(node.additional, into);
      break;
    case 'union':
    case 'intersection':
      for (const member of node.members) collectRefs(member, into);
      break;
    default:
      break;
  }
  return into;
}
