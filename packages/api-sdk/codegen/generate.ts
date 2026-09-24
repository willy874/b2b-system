import { emitObjectLiteral, emitTsType, jsDoc } from './emit-ts';
import type { TsEmitContext } from './emit-ts';
import { emitZod } from './emit-zod';
import type { ZodEmitContext } from './emit-zod';
import { propertyKey, kebabCase, pascalCase } from './naming';
import { collectOperations, successResponses } from './operations';
import type { Operation, Parameter, RequestBody, Response } from './operations';
import { collectRefs, toNode } from './schema-node';
import type { NodeContext, ObjectNode, SchemaNode } from './schema-node';
import { assertSupportedDocument } from './spec';
import type { OpenApiDocument } from './spec';

export const GENERATED_HEADER = '// 由 api-sdk codegen 產生，請勿手動編輯。';

export interface GenerateOptions {
  /** `runtime.ts` 的原始碼；原樣寫進輸出目錄 */
  runtimeSource: string;
}

export interface GeneratedFile {
  /** 相對於輸出目錄 */
  path: string;
  content: string;
}

export interface GenerateResult {
  files: GeneratedFile[];
  warnings: string[];
}

interface Component {
  name: string;
  typeName: string;
  schemaName: string;
  node: SchemaNode;
}

export function generate(input: unknown, options: GenerateOptions): GenerateResult {
  assertSupportedDocument(input);
  const document: OpenApiDocument = input;
  const nodeContext: NodeContext = { document, warnings: [] };

  const components = collectComponents(nodeContext);
  const operations = collectOperations(nodeContext);
  const byName = new Map(components.map((component) => [component.name, component]));
  const typeName = (name: string) => requireComponent(byName, name).typeName;
  const schemaName = (name: string) => requireComponent(byName, name).schemaName;

  const header = `${GENERATED_HEADER}\n// 來源：${document.info.title} ${document.info.version}（OpenAPI ${document.openapi}）\n`;
  const groups = groupByTag(operations);
  const files: GeneratedFile[] = [
    { path: 'runtime.ts', content: `${GENERATED_HEADER}\n${options.runtimeSource}` },
    { path: 'models.ts', content: `${header}\n${emitModels(components, { typeName })}` },
    {
      path: 'schemas.ts',
      content: `${header}\n${emitSchemas(components, { typeName, schemaName })}`,
    },
    ...[...groups].map(([tag, list]) => ({
      path: `endpoints/${tag}.ts`,
      content: `${header}\n${emitEndpoints(list, { typeName, schemaName })}`,
    })),
  ];
  files.push({ path: 'index.ts', content: `${header}\n${emitIndex(groups)}` });

  assertUniqueExports(files);
  return { files, warnings: [...new Set(nodeContext.warnings)] };
}

function requireComponent(byName: Map<string, Component>, name: string): Component {
  const component = byName.get(name);
  if (!component) throw new Error(`$ref 指向不存在的 schema「${name}」`);
  return component;
}

function collectComponents(ctx: NodeContext): Component[] {
  const schemas = ctx.document.components?.schemas ?? {};
  const seen = new Map<string, string>();
  return Object.entries(schemas).map(([name, schema]) => {
    const typeName = pascalCase(name);
    const previous = seen.get(typeName);
    if (previous) throw new Error(`schema「${name}」與「${previous}」產生相同的型別名 ${typeName}`);
    seen.set(typeName, name);
    return { name, typeName, schemaName: `${typeName}Schema`, node: toNode(schema, ctx) };
  });
}

function groupByTag(operations: Operation[]): Map<string, Operation[]> {
  const groups = new Map<string, Operation[]>();
  for (const operation of operations) {
    const tag = kebabCase(operation.tag) || 'default';
    groups.set(tag, [...(groups.get(tag) ?? []), operation]);
  }
  return new Map([...groups].toSorted(([a], [b]) => a.localeCompare(b)));
}

// ─── models.ts ──────────────────────────────────────────────────────────────

function emitModels(components: Component[], ctx: TsEmitContext): string {
  return components.map((component) => emitModel(component, ctx)).join('\n');
}

function emitModel({ typeName, node }: Component, ctx: TsEmitContext): string {
  const doc = jsDoc(node);
  // 字串 enum 另外輸出同名的 const 物件，執行期可以拿來列舉、比對（例：`PermissionKey['user:read']`）
  if (
    node.kind === 'enum' &&
    !node.nullable &&
    node.values.every((value) => typeof value === 'string')
  ) {
    const entries = node.values.map(
      (value) => `${propertyKey(String(value))}: ${JSON.stringify(value)},`,
    );
    return (
      `${doc}export const ${typeName} = {\n${entries.join('\n')}\n} as const;\n` +
      `${doc}export type ${typeName} = (typeof ${typeName})[keyof typeof ${typeName}];\n`
    );
  }
  if (node.kind === 'object' && !node.nullable && node.properties.length > 0) {
    return `${doc}export interface ${typeName} ${emitObjectLiteral(node, ctx)}\n`;
  }
  return `${doc}export type ${typeName} = ${emitTsType(node, ctx)};\n`;
}

// ─── schemas.ts ─────────────────────────────────────────────────────────────

/**
 * zod 常數必須先宣告再使用，所以依引用關係排序（DFS 後序）。
 * 循環引用的 schema 以 `z.lazy` 延後取值，並明確標註型別（推導會在循環上失敗）。
 */
function emitSchemas(
  components: Component[],
  ctx: { typeName: (name: string) => string; schemaName: (name: string) => string },
): string {
  const byName = new Map(components.map((component) => [component.name, component]));
  const order = sortByDependency(components);
  const cyclic = new Set(
    components
      .filter((component) => reaches(component.name, component.name, byName))
      .map((component) => component.name),
  );

  const declared = new Set<string>();
  const blocks: string[] = [];
  for (const component of order) {
    const zodContext: ZodEmitContext = {
      schemaName: ctx.schemaName,
      isLazy: (name) => !declared.has(name) || (cyclic.has(name) && cyclic.has(component.name)),
    };
    // 自己引用自己時，宣告還沒完成
    const expression = emitZod(component.node, zodContext);
    declared.add(component.name);
    blocks.push(
      cyclic.has(component.name)
        ? `export const ${component.schemaName}: z.ZodType<${component.typeName}> = ${expression};\n`
        : `export const ${component.schemaName} = ${expression} satisfies z.ZodType<${component.typeName}>;\n`,
    );
  }

  const typeNames = components.map((component) => component.typeName).toSorted();
  const imports = [`import { z } from 'zod';\n`];
  if (typeNames.length) imports.push(`import type { ${typeNames.join(', ')} } from './models';\n`);
  return `${imports.join('')}\n${blocks.join('\n')}`;
}

function sortByDependency(components: Component[]): Component[] {
  const byName = new Map(components.map((component) => [component.name, component]));
  const visited = new Set<string>();
  const order: Component[] = [];
  const visit = (component: Component): void => {
    if (visited.has(component.name)) return;
    visited.add(component.name);
    for (const ref of collectRefs(component.node)) {
      const target = byName.get(ref);
      if (target) visit(target);
    }
    order.push(component);
  };
  for (const component of components) visit(component);
  return order;
}

function reaches(from: string, target: string, byName: Map<string, Component>): boolean {
  const stack = [...collectRefs(byName.get(from)?.node ?? { kind: 'unknown' })];
  const seen = new Set<string>();
  while (stack.length) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    if (current === target) return true;
    seen.add(current);
    stack.push(...collectRefs(byName.get(current)?.node ?? { kind: 'unknown' }));
  }
  return false;
}

// ─── endpoints/<tag>.ts ─────────────────────────────────────────────────────

interface EndpointContext {
  typeName: (name: string) => string;
  schemaName: (name: string) => string;
}

function emitEndpoints(operations: Operation[], ctx: EndpointContext): string {
  const usedTypes = new Set<string>();
  const usedSchemas = new Set<string>();
  const runtimeValues = new Set(['request', 'buildUrl']);
  const runtimeTypes = new Set(['OperationDefinition', 'OperationSchemas']);
  const tsContext: TsEmitContext = {
    typeName: (name) => {
      const type = ctx.typeName(name);
      usedTypes.add(type);
      return type;
    },
  };
  const zodContext: ZodEmitContext = {
    schemaName: (name) => {
      const schema = ctx.schemaName(name);
      usedSchemas.add(schema);
      return schema;
    },
    isLazy: () => false,
  };

  const blocks = operations.map((operation) => {
    const block = emitOperation(operation, tsContext, zodContext);
    if (block.includes('ApiResponse<')) runtimeTypes.add('ApiResponse');
    if (block.includes('RequestOptions')) runtimeTypes.add('RequestOptions');
    return block;
  });
  const body = blocks.join('\n');

  const imports: string[] = [];
  if (/\bz\./.test(body)) imports.push(`import { z } from 'zod';`);
  imports.push(`import { ${[...runtimeValues].toSorted().join(', ')} } from '../runtime';`);
  imports.push(`import type { ${[...runtimeTypes].toSorted().join(', ')} } from '../runtime';`);
  if (usedTypes.size)
    imports.push(`import type { ${[...usedTypes].toSorted().join(', ')} } from '../models';`);
  if (usedSchemas.size)
    imports.push(`import { ${[...usedSchemas].toSorted().join(', ')} } from '../schemas';`);
  return `${imports.join('\n')}\n\n${body}`;
}

function emitOperation(operation: Operation, ts: TsEmitContext, zod: ZodEmitContext): string {
  const prefix = operation.typePrefix;
  const lines: string[] = [`// ${operation.method.toUpperCase()} ${operation.path}\n`];
  const inputFields: string[] = [];
  const schemaFields: string[] = [];

  const groups: [
    keyof Pick<Operation, 'pathParams' | 'queryParams' | 'headerParams'>,
    string,
    string,
  ][] = [
    ['pathParams', 'path', `${prefix}PathParams`],
    ['queryParams', 'query', `${prefix}QueryParams`],
    ['headerParams', 'headers', `${prefix}Headers`],
  ];
  for (const [key, field, typeName] of groups) {
    const params = operation[key];
    if (!params.length) continue;
    const node = paramsNode(params);
    lines.push(`export interface ${typeName} ${emitObjectLiteral(node, ts)}\n`);
    const required = params.some((param) => param.required);
    inputFields.push(`${field}${required ? '' : '?'}: ${typeName};`);
    schemaFields.push(`${field}: ${emitZod(node, zod)},`);
  }

  if (operation.body) {
    lines.push(`export type ${prefix}Body = ${bodyType(operation.body, ts)};\n`);
    inputFields.push(`body${operation.body.required ? '' : '?'}: ${prefix}Body;`);
    if (operation.body.bodyType === 'json' && operation.body.node) {
      const schema = emitZod(operation.body.node, zod);
      schemaFields.push(`body: ${operation.body.required ? schema : `${schema}.optional()`},`);
    }
  }

  const hasInput = inputFields.length > 0;
  const inputRequired =
    operation.pathParams.length > 0 ||
    operation.body?.required === true ||
    operation.queryParams.some((param) => param.required) ||
    operation.headerParams.some((param) => param.required);
  if (hasInput) lines.push(`export interface ${prefix}Input {\n${inputFields.join('\n')}\n}\n`);

  // 回應：所有宣告過的狀態碼都列進 Responses，成功的組成 Result
  const responseEntries = operation.responses.map(
    (response) => `${statusKey(response.status)}: ${responseType(response, ts)};`,
  );
  lines.push(
    responseEntries.length
      ? `export interface ${prefix}Responses {\n${responseEntries.join('\n')}\n}\n`
      : `export type ${prefix}Responses = Record<never, never>;\n`,
  );
  const success = successResponses(operation);
  const indexOf = (response: Response) => `${prefix}Responses[${statusKey(response.status)}]`;
  lines.push(
    `export type ${prefix}Response = ${success.map(indexOf).join(' | ') || 'undefined'};\n`,
    `export type ${prefix}Result = ${
      success
        .map((response) => `ApiResponse<${statusType(response.status)}, ${indexOf(response)}>`)
        .join(' | ') || 'ApiResponse<number, undefined>'
    };\n`,
  );

  const responseSchemas = operation.responses
    .filter((response) => response.responseType === 'json' && response.node)
    .map(
      (response) => `${statusKey(response.status)}: ${emitZod(response.node as SchemaNode, zod)},`,
    );
  if (responseSchemas.length) schemaFields.push(`responses: {\n${responseSchemas.join('\n')}\n},`);
  lines.push(
    `export const ${prefix}Schemas = {\n${schemaFields.join('\n')}\n} satisfies OperationSchemas;\n`,
  );

  // URL builder：(path?, query?)，沒有的參數就不出現在簽名裡
  const urlParams: string[] = [];
  const urlArgs: string[] = [];
  if (operation.pathParams.length) {
    urlParams.push(`path: ${prefix}PathParams`);
    urlArgs.push('path');
  }
  if (operation.queryParams.length) {
    const optional = operation.queryParams.every((param) => !param.required);
    urlParams.push(`query${optional ? '?' : ''}: ${prefix}QueryParams`);
    if (!operation.pathParams.length) urlArgs.push('undefined');
    urlArgs.push('query');
  }
  const pathLiteral = JSON.stringify(operation.path);
  lines.push(
    `export function get${prefix}Url(${urlParams.join(', ')}): string {\n` +
      `return buildUrl(${[pathLiteral, ...urlArgs].join(', ')});\n}\n`,
  );

  const definitionName = `${operation.functionName}Operation`;
  const definition = [
    `id: ${JSON.stringify(operation.id)},`,
    `method: ${JSON.stringify(operation.method.toUpperCase())},`,
    `path: ${pathLiteral},`,
    ...(operation.body
      ? [
          `bodyType: ${JSON.stringify(operation.body.bodyType)},`,
          `contentType: ${JSON.stringify(operation.body.contentType)},`,
        ]
      : []),
    `responseTypes: { ${operation.responses.map((response) => `${statusKey(response.status)}: ${JSON.stringify(response.responseType)}`).join(', ')} },`,
    `schemas: ${prefix}Schemas,`,
  ];
  lines.push(`const ${definitionName}: OperationDefinition = {\n${definition.join('\n')}\n};\n`);

  const doc = jsDoc({
    description:
      [operation.summary, operation.description].filter(Boolean).join('\n\n') || undefined,
    deprecated: operation.deprecated,
  });
  const inputParam = !hasInput
    ? ''
    : inputRequired
      ? `input: ${prefix}Input, `
      : `input: ${prefix}Input = {}, `;
  lines.push(
    `${doc}export function ${operation.functionName}(${inputParam}options?: RequestOptions): Promise<${prefix}Result> {\n` +
      `return request<${prefix}Result>(${definitionName}, ${hasInput ? 'input' : '{}'}, options);\n}\n`,
  );
  return lines.join('\n');
}

function paramsNode(params: Parameter[]): ObjectNode {
  return {
    kind: 'object',
    additional: false,
    properties: params.map((param) => ({
      name: param.name,
      required: param.required,
      node: {
        ...param.node,
        description: param.description ?? param.node.description,
        deprecated: param.deprecated ?? param.node.deprecated,
      },
    })),
  };
}

function bodyType(body: RequestBody, ts: TsEmitContext): string {
  const structured = body.node ? emitTsType(body.node, ts) : undefined;
  switch (body.bodyType) {
    case 'json':
      return structured ?? 'unknown';
    case 'form-data':
      return structured ? `FormData | ${structured}` : 'FormData';
    case 'url-encoded':
      return structured
        ? `URLSearchParams | ${structured}`
        : 'URLSearchParams | Record<string, string>';
    case 'text':
      return 'string';
    case 'binary':
      return 'Blob | ArrayBuffer | ArrayBufferView | ReadableStream';
  }
}

function responseType(response: Response, ts: TsEmitContext): string {
  switch (response.responseType) {
    case 'none':
      return 'undefined';
    case 'text':
      return 'string';
    case 'blob':
      return 'Blob';
    case 'json':
      return response.node ? emitTsType(response.node, ts) : 'unknown';
  }
}

function statusKey(status: string): string {
  return /^\d+$/.test(status) ? status : JSON.stringify(status);
}

function statusType(status: string): string {
  return /^\d+$/.test(status) ? status : 'number';
}

// ─── index.ts ───────────────────────────────────────────────────────────────

function emitIndex(groups: Map<string, Operation[]>): string {
  const lines = [
    "export * from './runtime';",
    "export * from './models';",
    "export * from './schemas';",
  ];
  for (const tag of groups.keys()) lines.push(`export * from './endpoints/${tag}';`);
  return `${lines.join('\n')}\n`;
}

/** `export *` 撞名時 TS 只會默默略過其中一個；在產生階段就擋下來。 */
function assertUniqueExports(files: GeneratedFile[]): void {
  const owners = new Map<string, string>();
  for (const file of files) {
    if (file.path === 'index.ts') continue;
    const names = new Set(
      [
        ...file.content.matchAll(
          /^export (?:declare )?(?:async )?(?:class|function|interface|type|const|let) ([A-Za-z_$][\w$]*)/gm,
        ),
      ].map((match) => match[1] ?? ''),
    );
    for (const name of names) {
      const owner = owners.get(name);
      if (owner)
        throw new Error(
          `匯出名稱「${name}」同時出現在 ${owner} 與 ${file.path}，請調整 schema 名稱或 operationId`,
        );
      owners.set(name, file.path);
    }
  }
}
