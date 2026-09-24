import { propertyKey } from './naming';
import type { EnumValue, NumberNode, SchemaNode, StringNode } from './schema-node';

export interface ZodEmitContext {
  /** component 原名 → schema 常數名 */
  schemaName: (componentName: string) => string;
  /** 這個 component 的引用是否要包 `z.lazy`（循環引用、或引用尚未宣告的 schema） */
  isLazy: (componentName: string) => boolean;
}

/** 有專屬 builder 的 format；其餘 format 退回 `z.string()`。 */
const STRING_FORMATS: Record<string, string> = {
  email: 'z.email()',
  uuid: 'z.uuid()',
  uri: 'z.url()',
  url: 'z.url()',
  'date-time': 'z.iso.datetime({ offset: true })',
  date: 'z.iso.date()',
  time: 'z.iso.time()',
  ipv4: 'z.ipv4()',
  ipv6: 'z.ipv6()',
  byte: 'z.base64()',
};

/** node → zod 運算式。 */
export function emitZod(node: SchemaNode, ctx: ZodEmitContext): string {
  let expression = emitBare(node, ctx);
  if (node.nullable && node.kind !== 'null') expression += '.nullable()';
  if (node.hasDefault) expression += `.default(${JSON.stringify(node.defaultValue)})`;
  return expression;
}

function emitBare(node: SchemaNode, ctx: ZodEmitContext): string {
  switch (node.kind) {
    case 'ref': {
      const name = ctx.schemaName(node.name);
      return ctx.isLazy(node.name) ? `z.lazy(() => ${name})` : name;
    }
    case 'string':
      return emitString(node);
    case 'number':
      return emitNumber(node);
    case 'boolean':
      return 'z.boolean()';
    case 'null':
      return 'z.null()';
    case 'unknown':
      return 'z.unknown()';
    case 'enum':
      return emitEnum(node.values);
    case 'array': {
      let expression = `z.array(${emitZod(node.items, ctx)})`;
      if (node.minItems !== undefined) expression += `.min(${node.minItems})`;
      if (node.maxItems !== undefined) expression += `.max(${node.maxItems})`;
      return expression;
    }
    case 'union':
      if (node.members.length === 0) return 'z.never()';
      if (node.members.length === 1 && node.members[0]) return emitZod(node.members[0], ctx);
      return `z.union([${node.members.map((member) => emitZod(member, ctx)).join(', ')}])`;
    case 'intersection': {
      const [first, ...rest] = node.members.map((member) => emitZod(member, ctx));
      return rest.reduce(
        (left, right) => `z.intersection(${left}, ${right})`,
        first ?? 'z.unknown()',
      );
    }
    case 'object': {
      if (node.properties.length === 0 && node.additional !== false) {
        const value = node.additional === true ? 'z.unknown()' : emitZod(node.additional, ctx);
        return `z.record(z.string(), ${value})`;
      }
      const shape = node.properties.map((property) => {
        let value = emitZod(property.node, ctx);
        // 有預設值的欄位在輸入端本來就是選填；再加 `.optional()` 會讓輸出也變成選填
        if (!property.required && !property.node.hasDefault) value += '.optional()';
        return `${propertyKey(property.name)}: ${value},`;
      });
      const object = `z.object({\n${shape.join('\n')}\n})`;
      if (node.additional === false) return object;
      return `${object}.catchall(${node.additional === true ? 'z.unknown()' : emitZod(node.additional, ctx)})`;
    }
  }
}

function emitString(node: StringNode): string {
  if (node.format === 'binary') return 'z.instanceof(Blob)';
  let expression = (node.format && STRING_FORMATS[node.format]) || 'z.string()';
  if (node.minLength !== undefined) expression += `.min(${node.minLength})`;
  if (node.maxLength !== undefined) expression += `.max(${node.maxLength})`;
  if (node.pattern !== undefined)
    expression += `.regex(new RegExp(${JSON.stringify(node.pattern)}))`;
  return expression;
}

function emitNumber(node: NumberNode): string {
  let expression = node.integer ? 'z.int()' : 'z.number()';
  if (node.minimum !== undefined) expression += `.min(${node.minimum})`;
  if (node.maximum !== undefined) expression += `.max(${node.maximum})`;
  if (node.exclusiveMinimum !== undefined) expression += `.gt(${node.exclusiveMinimum})`;
  if (node.exclusiveMaximum !== undefined) expression += `.lt(${node.exclusiveMaximum})`;
  if (node.multipleOf !== undefined) expression += `.multipleOf(${node.multipleOf})`;
  return expression;
}

function emitEnum(values: EnumValue[]): string {
  if (values.length > 0 && values.every((value) => typeof value === 'string')) {
    return `z.enum([${values.map((value) => JSON.stringify(value)).join(', ')}])`;
  }
  const literals = values.map((value) => `z.literal(${JSON.stringify(value)})`);
  if (literals.length === 1 && literals[0]) return literals[0];
  return `z.union([${literals.join(', ')}])`;
}
