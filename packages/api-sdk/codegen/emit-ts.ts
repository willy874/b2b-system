import { propertyKey } from './naming';
import type { EnumValue, SchemaNode } from './schema-node';

export interface TsEmitContext {
  /** component 原名 → TS 型別名 */
  typeName: (componentName: string) => string;
}

/** node → TS 型別運算式（不含 `export type X =`）。 */
export function emitTsType(node: SchemaNode, ctx: TsEmitContext): string {
  const base = emitBare(node, ctx);
  return node.nullable && node.kind !== 'null' ? `${wrap(base)} | null` : base;
}

function emitBare(node: SchemaNode, ctx: TsEmitContext): string {
  switch (node.kind) {
    case 'ref':
      return ctx.typeName(node.name);
    case 'string':
      return node.format === 'binary' ? 'Blob' : 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'unknown':
      return 'unknown';
    case 'enum':
      return node.values.map(literal).join(' | ');
    case 'array':
      return `Array<${emitTsType(node.items, ctx)}>`;
    case 'union':
      return node.members.map((member) => wrap(emitTsType(member, ctx))).join(' | ') || 'never';
    case 'intersection':
      return node.members.map((member) => wrap(emitTsType(member, ctx))).join(' & ');
    case 'object':
      return emitObjectLiteral(node, ctx);
  }
}

export function emitObjectLiteral(
  node: Extract<SchemaNode, { kind: 'object' }>,
  ctx: TsEmitContext,
): string {
  if (node.properties.length === 0) {
    if (node.additional === false) return 'Record<string, never>';
    const value = node.additional === true ? 'unknown' : emitTsType(node.additional, ctx);
    return `Record<string, ${value}>`;
  }
  const lines = node.properties.map((property) => {
    const doc = jsDoc(property.node);
    const optional = property.required ? '' : '?';
    return `${doc}${propertyKey(property.name)}${optional}: ${emitTsType(property.node, ctx)};`;
  });
  // 有具名欄位時 index signature 只能用 unknown：值型別必須相容於每個具名欄位
  if (node.additional !== false) lines.push('[key: string]: unknown;');
  return `{\n${lines.join('\n')}\n}`;
}

/** 屬性或宣告前的 JSDoc；沒有內容時回傳空字串。 */
export function jsDoc(node: { description?: string; deprecated?: boolean }): string {
  const lines: string[] = [];
  if (node.description) lines.push(...node.description.split('\n'));
  if (node.deprecated) lines.push('@deprecated');
  if (!lines.length) return '';
  const body = lines.map((line) => line.replaceAll('*/', '*\\/'));
  return body.length === 1
    ? `/** ${body[0]} */\n`
    : `/**\n${body.map((line) => ` * ${line}`).join('\n')}\n */\n`;
}

function literal(value: EnumValue): string {
  return value === null ? 'null' : JSON.stringify(value);
}

/** 聯集／交集放進陣列或另一個組合時要加括號。 */
function wrap(type: string): string {
  return hasTopLevelOperator(type) ? `(${type})` : type;
}

function hasTopLevelOperator(type: string): boolean {
  let depth = 0;
  let quote: string | undefined;
  for (let index = 0; index < type.length; index += 1) {
    const char = type.charAt(index);
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") quote = char;
    else if ('<{(['.includes(char)) depth += 1;
    else if ('>})]'.includes(char)) depth -= 1;
    else if (depth === 0 && (char === '|' || char === '&')) return true;
  }
  return false;
}
