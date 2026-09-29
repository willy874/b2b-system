import Ajv from 'ajv';
import type { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import Ajv2019 from 'ajv/dist/2019';
import Ajv2020 from 'ajv/dist/2020';

import type { JsonPath } from '../JsonViewer/jsonLines';
import type { JsonValidationError } from './validation';

/**
 * 只由 `createJsonSchemaValidator` 動態載入。
 * ajv 會把 schema 編譯成 JavaScript（`new Function`）：之後若啟用不含 `unsafe-eval` 的 CSP，
 * 要改成建置時預先編譯（ajv standalone），見 docs/adr/0010-self-built-json-editor.md。
 */

function createAjv(schema: object | boolean) {
  const dialect =
    typeof schema === 'object' ? String((schema as { $schema?: unknown }).$schema ?? '') : '';
  // allErrors：一次列出所有錯誤；strict: false：接受 schema 裡的自訂註解關鍵字（title 以外的 x-*）
  const options = { allErrors: true, strict: false };
  const ajv = dialect.includes('2020-12')
    ? new Ajv2020(options)
    : dialect.includes('2019-09')
      ? new Ajv2019(options)
      : new Ajv(options);
  addFormats(ajv);
  return ajv;
}

/** JSON Pointer（`/tags/1`）轉成路徑；陣列的索引轉成數字（看實際的資料決定）。 */
function pointerToPath(pointer: string, root: unknown): Array<string | number> {
  if (pointer === '') return [];
  const path: Array<string | number> = [];
  let node = root;
  for (const raw of pointer.slice(1).split('/')) {
    const segment = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    const key = Array.isArray(node) ? Number(segment) : segment;
    path.push(key);
    node =
      typeof node === 'object' && node !== null
        ? (node as Record<string | number, unknown>)[key]
        : undefined;
  }
  return path;
}

function toValidationError(error: ErrorObject, root: unknown): JsonValidationError {
  const path: JsonPath = pointerToPath(error.instancePath, root);
  // 多出來的鍵：標在那個鍵上，而不是整個物件
  const extra =
    error.keyword === 'additionalProperties' || error.keyword === 'unevaluatedProperties'
      ? (error.params as { additionalProperty?: string; unevaluatedProperty?: string })
      : undefined;
  const extraKey = extra?.additionalProperty ?? extra?.unevaluatedProperty;
  return {
    path: extraKey === undefined ? path : [...path, extraKey],
    message:
      extraKey === undefined
        ? (error.message ?? error.keyword)
        : `${error.message ?? ''}: ${extraKey}`,
    keyword: error.keyword,
    params: error.params as Record<string, unknown>,
  };
}

export function compileJsonSchema(schema: object | boolean) {
  const validate = createAjv(schema).compile(schema);
  return (value: unknown): JsonValidationError[] =>
    validate(value) ? [] : (validate.errors ?? []).map((error) => toValidationError(error, value));
}
