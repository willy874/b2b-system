const RESERVED = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'let',
  'static',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
  'await',
]);

/** 以非英數字元與大小寫邊界切字：`UserController_list` → [User, Controller, list]。 */
function splitWords(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

/** 全大寫的縮寫也當成一般單字：`HTTP` → `Http`，camelCase 才會是 `httpStatus` 而不是 `hTTPStatus`。 */
function capitalize(word: string): string {
  const normalized = /^[A-Z0-9]+$/.test(word) ? word.toLowerCase() : word;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function pascalCase(input: string): string {
  const result = splitWords(input).map(capitalize).join('');
  if (!result) throw new Error(`無法從「${input}」產生識別字`);
  return /^[0-9]/.test(result) ? `_${result}` : result;
}

export function camelCase(input: string): string {
  const pascal = pascalCase(input);
  const result = pascal.charAt(0).toLowerCase() + pascal.slice(1);
  return RESERVED.has(result) ? `${result}_` : result;
}

export function kebabCase(input: string): string {
  return splitWords(input)
    .map((word) => word.toLowerCase())
    .join('-');
}

export function isIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !RESERVED.has(name);
}

/** 物件鍵：合法識別字不加引號，其餘用 JSON 字串。 */
export function propertyKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

/** 屬性存取：`a.b` 或 `a["b-c"]`。 */
export function propertyAccess(target: string, name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
    ? `${target}.${name}`
    : `${target}[${JSON.stringify(name)}]`;
}
