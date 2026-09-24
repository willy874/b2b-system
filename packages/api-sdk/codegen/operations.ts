import { camelCase, pascalCase } from './naming';
import { toNode } from './schema-node';
import type { NodeContext, SchemaNode } from './schema-node';
import { deref } from './spec';
import type {
  MediaTypeObject,
  OperationObject,
  ParameterObject,
  PathItemObject,
  RequestBodyObject,
  ResponseObject,
} from './spec';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** 執行期怎麼處理 body；與 `runtime.ts` 的 `BodyType` 對應。 */
export type BodyType = 'json' | 'form-data' | 'url-encoded' | 'text' | 'binary';
/** 執行期怎麼解析回應；與 `runtime.ts` 的 `ResponseType` 對應。 */
export type ResponseType = 'json' | 'text' | 'blob' | 'none';

export interface Parameter {
  name: string;
  node: SchemaNode;
  required: boolean;
  description?: string;
  deprecated?: boolean;
}

export interface RequestBody {
  bodyType: BodyType;
  required: boolean;
  /** json / form-data / url-encoded 才會有；只有 json 會產生 zod 驗證 */
  node?: SchemaNode;
  contentType: string;
}

export interface Response {
  /** `200`、`2XX` 或 `default` */
  status: string;
  responseType: ResponseType;
  node?: SchemaNode;
}

export interface Operation {
  id: string;
  /** 函式名：`userControllerList` */
  functionName: string;
  /** 型別前綴：`UserControllerList` */
  typePrefix: string;
  method: HttpMethod;
  path: string;
  tag: string;
  summary?: string;
  description?: string;
  deprecated: boolean;
  pathParams: Parameter[];
  queryParams: Parameter[];
  headerParams: Parameter[];
  body?: RequestBody;
  responses: Response[];
}

export function collectOperations(ctx: NodeContext): Operation[] {
  const operations: Operation[] = [];
  const seen = new Map<string, string>();

  for (const [path, rawItem] of Object.entries(ctx.document.paths ?? {})) {
    if (!rawItem) continue;
    const item = deref<PathItemObject>(ctx.document, rawItem);
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!operation) continue;
      const id = operation.operationId ?? `${method} ${path}`;
      const functionName = camelCase(id);
      const previous = seen.get(functionName);
      if (previous) {
        throw new Error(
          `operation「${id}」與「${previous}」產生相同的函式名 ${functionName}，請調整 operationId`,
        );
      }
      seen.set(functionName, id);
      operations.push(buildOperation(ctx, { id, path, method, item, operation, functionName }));
    }
  }
  return operations;
}

interface BuildInput {
  id: string;
  path: string;
  method: HttpMethod;
  item: PathItemObject;
  operation: OperationObject;
  functionName: string;
}

function buildOperation(ctx: NodeContext, input: BuildInput): Operation {
  const { operation } = input;
  const parameters = mergeParameters(ctx, input.item.parameters, operation.parameters);
  const pick = (location: string) =>
    parameters
      .filter((parameter) => parameter.in === location)
      .map((parameter) => toParameter(ctx, parameter));

  // path 參數一律必填（OpenAPI 規定），不論 spec 有沒有寫 `required: true`
  const pathParams = pick('path');
  for (const parameter of pathParams) parameter.required = true;
  const declared = new Set(pathParams.map((parameter) => parameter.name));
  for (const [, name] of input.path.matchAll(/\{([^}]+)\}/g)) {
    if (name && !declared.has(name)) {
      throw new Error(`${input.id}：路徑用到 {${name}} 但沒有宣告對應的 path 參數`);
    }
  }
  if (parameters.some((parameter) => parameter.in === 'cookie')) {
    ctx.warnings.push(`${input.id}：cookie 參數不會產生（瀏覽器由 credentials 自動帶）`);
  }

  const result: Operation = {
    id: input.id,
    functionName: input.functionName,
    typePrefix: pascalCase(input.id),
    method: input.method,
    path: input.path,
    tag: operation.tags?.[0] ?? 'default',
    deprecated: operation.deprecated === true,
    pathParams,
    queryParams: pick('query'),
    headerParams: pick('header'),
    responses: Object.entries(operation.responses ?? {}).map(([status, response]) =>
      toResponse(ctx, status, deref<ResponseObject>(ctx.document, response)),
    ),
  };
  if (operation.summary) result.summary = operation.summary;
  if (operation.description) result.description = operation.description;
  if (operation.requestBody) {
    result.body = toRequestBody(
      ctx,
      input.id,
      deref<RequestBodyObject>(ctx.document, operation.requestBody),
    );
  }
  return result;
}

/** path item 的參數是預設值，operation 的同名同位置參數覆寫它。 */
function mergeParameters(
  ctx: NodeContext,
  shared: PathItemObject['parameters'],
  own: OperationObject['parameters'],
): ParameterObject[] {
  const merged = new Map<string, ParameterObject>();
  for (const raw of [...(shared ?? []), ...(own ?? [])]) {
    const parameter = deref<ParameterObject>(ctx.document, raw);
    merged.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  return [...merged.values()];
}

function toParameter(ctx: NodeContext, parameter: ParameterObject): Parameter {
  const schema = parameter.schema ?? mediaSchema(parameter.content);
  const result: Parameter = {
    name: parameter.name,
    node: schema ? toNode(schema, ctx) : { kind: 'string' },
    required: parameter.required === true,
  };
  if (parameter.description) result.description = parameter.description;
  if (parameter.deprecated) result.deprecated = true;
  return result;
}

function mediaSchema(content: Record<string, MediaTypeObject> | undefined) {
  return content ? Object.values(content)[0]?.schema : undefined;
}

function toRequestBody(ctx: NodeContext, id: string, body: RequestBodyObject): RequestBody {
  const entries = Object.entries(body.content ?? {});
  const json = entries.find(([type]) => isJson(type));
  const [contentType, media] = json ?? entries[0] ?? [];
  if (!contentType || !media) throw new Error(`${id}：requestBody 沒有任何 content`);
  if (!json && entries.length > 1) {
    ctx.warnings.push(`${id}：requestBody 有多個 content type，只產生「${contentType}」`);
  }

  const bodyType = bodyTypeOf(contentType);
  const result: RequestBody = { bodyType, required: body.required === true, contentType };
  const structured = bodyType === 'json' || bodyType === 'form-data' || bodyType === 'url-encoded';
  if (structured && media.schema) result.node = toNode(media.schema, ctx);
  return result;
}

function toResponse(ctx: NodeContext, status: string, response: ResponseObject): Response {
  const entries = Object.entries(response.content ?? {});
  const [contentType, media] = entries.find(([type]) => isJson(type)) ?? entries[0] ?? [];
  if (!contentType) return { status, responseType: 'none' };

  const responseType: ResponseType = isJson(contentType)
    ? 'json'
    : contentType.startsWith('text/')
      ? 'text'
      : 'blob';
  const result: Response = { status, responseType };
  if (responseType === 'json' && media?.schema) result.node = toNode(media.schema, ctx);
  return result;
}

function isJson(contentType: string): boolean {
  return /^application\/(.+\+)?json/.test(contentType) || contentType === '*/*';
}

function bodyTypeOf(contentType: string): BodyType {
  if (isJson(contentType)) return 'json';
  if (contentType.startsWith('multipart/')) return 'form-data';
  if (contentType === 'application/x-www-form-urlencoded') return 'url-encoded';
  if (contentType.startsWith('text/')) return 'text';
  return 'binary';
}

/** 2xx（含 `2XX`）視為成功；只有 `default` 一種回應時也當成成功。 */
export function successResponses(operation: Operation): Response[] {
  const success = operation.responses.filter((response) => /^2(\d\d|XX)$/i.test(response.status));
  if (success.length) return success;
  const fallback = operation.responses.find((response) => response.status === 'default');
  return fallback ? [fallback] : [];
}
