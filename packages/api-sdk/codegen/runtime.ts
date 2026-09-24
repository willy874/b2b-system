/**
 * 產生的 endpoint 共用的執行期：只有 `fetch`，沒有攔截器／middleware。
 * 需要認證標頭、續期、重試的應用，自行包一層（或透過 `options.fetch` 注入自己的 fetch）。
 *
 * 這個檔案由產生器原樣複製到輸出目錄，讓每一份 SDK 自給自足、各自持有自己的設定。
 */
import type { ZodType } from 'zod';

export type BodyType = 'json' | 'form-data' | 'url-encoded' | 'text' | 'binary';
export type ResponseType = 'json' | 'text' | 'blob' | 'none';

export interface ValidateOptions {
  /** 送出前以 zod 驗證 path / query / headers / body，並送出 parse 後的值（會套用預設值） */
  request?: boolean;
  /** 以 zod 驗證成功回應的 body */
  response?: boolean;
}

export interface SdkConfig {
  /** 加在每個路徑前面，例：`/api`、`https://api.example.com` */
  baseUrl: string;
  /** 預設用呼叫當下的 `globalThis.fetch`（測試可以直接 stub 全域 fetch） */
  fetch?: typeof fetch;
  /** 每個請求都帶的標頭 */
  headers?: HeadersInit;
  validate: boolean | ValidateOptions;
}

export interface RequestOptions extends Omit<RequestInit, 'method' | 'body'> {
  baseUrl?: string;
  fetch?: typeof fetch;
  validate?: boolean | ValidateOptions;
}

export interface ApiResponse<TStatus extends number = number, TData = unknown> {
  status: TStatus;
  data: TData;
  headers: Headers;
}

/** 非 2xx 回應。`data` 已依 content-type 解析（JSON 失敗時保留原文）。 */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly data: unknown,
    readonly headers: Headers,
    readonly operationId: string,
  ) {
    super(`${operationId} 回應 HTTP ${status}`);
  }
}

export type ValidationTarget = 'path' | 'query' | 'headers' | 'body' | 'response';

/** 開啟驗證時，請求或回應不符合 schema。`cause` 是原始的 ZodError。 */
export class ApiValidationError extends Error {
  override readonly name = 'ApiValidationError';

  constructor(
    readonly target: ValidationTarget,
    readonly operationId: string,
    cause: unknown,
  ) {
    super(`${operationId} 的 ${target} 不符合 schema`, { cause });
  }
}

export interface OperationSchemas {
  path?: ZodType;
  query?: ZodType;
  headers?: ZodType;
  body?: ZodType;
  responses?: Record<string, ZodType>;
}

export interface OperationInput {
  path?: object;
  query?: object;
  headers?: object;
  body?: unknown;
}

export interface OperationDefinition {
  id: string;
  method: string;
  /** 路徑樣板，例：`/users/{id}` */
  path: string;
  bodyType?: BodyType;
  contentType?: string;
  responseTypes: Record<string, ResponseType>;
  schemas: OperationSchemas;
}

const DEFAULT_CONFIG: SdkConfig = { baseUrl: '', validate: false };
let config: SdkConfig = { ...DEFAULT_CONFIG };

/** 設定這份 SDK 的預設值；只覆寫有給的欄位。 */
export function configureSdk(next: Partial<SdkConfig>): void {
  config = { ...config, ...next };
}

export function getSdkConfig(): Readonly<SdkConfig> {
  return config;
}

export function resetSdkConfig(): void {
  config = { ...DEFAULT_CONFIG };
}

/** 路徑樣板 ＋ 參數 → 相對 URL（不含 baseUrl）。 */
export function buildUrl(template: string, path?: object, query?: object): string {
  const values = (path ?? {}) as Record<string, unknown>;
  const resolved = template.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined || value === null)
      throw new Error(`缺少 path 參數「${name}」（${template}）`);
    return encodeURIComponent(String(value));
  });
  return `${resolved}${serializeQuery(query)}`;
}

/**
 * OpenAPI 預設的 `form` + `explode`：陣列展開成重複的 key；物件以 `deepObject`（`a[b]=c`）表示。
 * `undefined` / `null` 略過。
 */
export function serializeQuery(query?: object): string {
  if (!query) return '';
  const search = new URLSearchParams();
  const append = (key: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      for (const item of value) append(key, item);
    } else if (value instanceof Date) {
      search.append(key, value.toISOString());
    } else if (typeof value === 'object') {
      for (const [child, childValue] of Object.entries(value))
        append(`${key}[${child}]`, childValue);
    } else {
      search.append(key, String(value));
    }
  };
  for (const [key, value] of Object.entries(query)) append(key, value);
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** 產生的 endpoint 函式都呼叫這支。 */
export async function request<TResult>(
  operation: OperationDefinition,
  input: OperationInput,
  options: RequestOptions = {},
): Promise<TResult> {
  const { baseUrl = config.baseUrl, fetch: customFetch, validate, ...init } = options;
  const checks = normalizeValidate(validate ?? config.validate);
  const { schemas } = operation;

  const path = checks.request ? parse(schemas.path, input.path, 'path', operation) : input.path;
  const query = checks.request
    ? parse(schemas.query, input.query, 'query', operation)
    : input.query;
  const headerParams = checks.request
    ? parse(schemas.headers, input.headers, 'headers', operation)
    : input.headers;
  const body = checks.request ? parse(schemas.body, input.body, 'body', operation) : input.body;

  const headers = new Headers(config.headers);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  for (const [key, value] of Object.entries(headerParams ?? {})) {
    if (value !== undefined && value !== null) headers.set(key, String(value));
  }

  const requestInit: RequestInit = { ...init, method: operation.method, headers };
  if (operation.bodyType && body !== undefined) {
    requestInit.body = encodeBody(operation.bodyType, body);
    // multipart 的 content-type 要由瀏覽器帶上 boundary，不能自己設
    if (
      operation.bodyType !== 'form-data' &&
      operation.contentType &&
      !headers.has('content-type')
    ) {
      headers.set('content-type', operation.contentType);
    }
  }

  const url = `${baseUrl}${buildUrl(operation.path, path as object | undefined, query as object | undefined)}`;
  const response = await (customFetch ?? config.fetch ?? globalThis.fetch)(url, requestInit);
  const data = await decodeBody(response, pickByStatus(operation.responseTypes, response.status));

  if (!response.ok) throw new ApiError(response.status, data, response.headers, operation.id);

  const checked = checks.response
    ? parse(pickByStatus(schemas.responses ?? {}, response.status), data, 'response', operation)
    : data;
  const result: ApiResponse = { status: response.status, data: checked, headers: response.headers };
  // 回應的實際型別由產生的 `XxxResult` 描述（依狀態碼區分）；執行期無法再多證明什麼
  return result as TResult;
}

function normalizeValidate(value: boolean | ValidateOptions): Required<ValidateOptions> {
  if (typeof value === 'boolean') return { request: value, response: value };
  return { request: value.request ?? false, response: value.response ?? false };
}

function parse(
  schema: ZodType | undefined,
  value: unknown,
  target: ValidationTarget,
  operation: OperationDefinition,
): unknown {
  if (!schema) return value;
  // 選填的 query / headers 沒給時不驗證（schema 是物件，undefined 會被拒絕）
  if (value === undefined && target !== 'body' && target !== 'response') return value;
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiValidationError(target, operation.id, result.error);
  return result.data;
}

/** 精確狀態碼 → `2XX` 範圍 → `default`。 */
function pickByStatus<T>(map: Record<string, T>, status: number): T | undefined {
  return map[String(status)] ?? map[`${String(status).charAt(0)}XX`] ?? map.default;
}

function encodeBody(bodyType: BodyType, body: unknown): BodyInit {
  switch (bodyType) {
    case 'json':
      return JSON.stringify(body);
    case 'text':
      return String(body);
    case 'form-data':
      return body instanceof FormData ? body : toFormData(body as Record<string, unknown>);
    case 'url-encoded':
      return body instanceof URLSearchParams
        ? body
        : new URLSearchParams(serializeQuery(body as object).slice(1));
    case 'binary':
      return body as BodyInit;
  }
}

function toFormData(body: Record<string, unknown>): FormData {
  const form = new FormData();
  const append = (key: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) for (const item of value) append(key, item);
    else if (value instanceof Blob) form.append(key, value);
    else if (typeof value === 'object') form.append(key, JSON.stringify(value));
    else form.append(key, String(value));
  };
  for (const [key, value] of Object.entries(body)) append(key, value);
  return form;
}

async function decodeBody(
  response: Response,
  declared: ResponseType | undefined,
): Promise<unknown> {
  if (declared === 'none' || response.status === 204 || response.status === 205) return undefined;
  if (declared === 'blob') return response.blob();
  const text = await response.text();
  if (declared === 'text') return text;
  if (!text.length) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  if (declared === 'json' || /json/.test(contentType)) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // 例：proxy 在 502 時回 HTML。保留原文，交給狀態碼或 response 驗證判斷
      return text;
    }
  }
  return text;
}
