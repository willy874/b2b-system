import type { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types';

/** 同時支援 3.0 與 3.1；兩者在產生器關心的欄位上幾乎一致，差異集中在 `schema-node.ts` 處理。 */
export type OpenApiDocument = OpenAPIV3.Document | OpenAPIV3_1.Document;
export type SchemaObject = OpenAPIV3.SchemaObject | OpenAPIV3_1.SchemaObject;
export type ReferenceObject = OpenAPIV3.ReferenceObject;
export type ParameterObject = OpenAPIV3.ParameterObject;
export type RequestBodyObject = OpenAPIV3.RequestBodyObject;
export type ResponseObject = OpenAPIV3.ResponseObject;
export type MediaTypeObject = OpenAPIV3.MediaTypeObject;
export type OperationObject = OpenAPIV3.OperationObject;
export type PathItemObject = OpenAPIV3.PathItemObject;

export const SCHEMA_REF_PREFIX = '#/components/schemas/';

export function isRef(value: unknown): value is ReferenceObject {
  return typeof value === 'object' && value !== null && '$ref' in value;
}

export function assertSupportedDocument(value: unknown): asserts value is OpenApiDocument {
  if (typeof value !== 'object' || value === null || !('openapi' in value)) {
    throw new Error('輸入不是 OpenAPI 文件：缺少 `openapi` 欄位（Swagger 2.0 請先轉成 OpenAPI 3）');
  }
  const version = String(value.openapi);
  if (!/^3\.[01]\./.test(version)) {
    throw new Error(`不支援的 OpenAPI 版本 ${version}：只支援 3.0.x 與 3.1.x`);
  }
}

/** 只解析文件內的 JSON Pointer；外部檔案的 `$ref` 請先用 bundler 合併。 */
export function resolvePointer(document: OpenApiDocument, ref: string): unknown {
  if (!ref.startsWith('#/')) {
    throw new Error(`不支援外部 $ref「${ref}」：請先把 spec bundle 成單一檔案`);
  }
  let current: unknown = document;
  for (const raw of ref.slice(2).split('/')) {
    const segment = decodeURIComponent(raw).replaceAll('~1', '/').replaceAll('~0', '~');
    if (typeof current !== 'object' || current === null || !(segment in current)) {
      throw new Error(`$ref「${ref}」指向不存在的位置`);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** 參數、requestBody、response 的 `$ref` 直接展開（可能串好幾層）。 */
export function deref<T extends object>(document: OpenApiDocument, value: T | ReferenceObject): T {
  let current: unknown = value;
  const seen = new Set<string>();
  while (isRef(current)) {
    if (seen.has(current.$ref)) throw new Error(`$ref「${current.$ref}」形成循環`);
    seen.add(current.$ref);
    current = resolvePointer(document, current.$ref);
  }
  return current as T;
}
