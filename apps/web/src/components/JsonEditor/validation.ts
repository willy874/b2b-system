import type { JsonPath } from '../JsonViewer/jsonLines';

export interface JsonValidationError {
  /** 出錯的節點；`required` 指向缺欄位的物件、`additionalProperties` 指向多出來的那個鍵。 */
  path: JsonPath;
  message: string;
  /** 產生錯誤的 schema 關鍵字（`type`、`minimum`、`required`…），`features/` 要自行翻譯時用。 */
  keyword: string;
  params: Record<string, unknown>;
}

/**
 * 驗證函式（與 svelte-jsoneditor 的 `validator` 相同的形狀）；可以是非同步的。
 * 不一定要用 JSON Schema：業務規則也可以寫成一個 validator。
 */
export type JsonValidator = (
  value: unknown,
) => readonly JsonValidationError[] | Promise<readonly JsonValidationError[]>;

export interface JsonSchemaValidatorOptions {
  /** 改寫錯誤訊息（例如依 `keyword` / `params` 翻譯）；預設是 ajv 的英文訊息。 */
  formatMessage?: (error: JsonValidationError) => string;
}

/**
 * 以 JSON Schema 驗證（ajv，依 `$schema` 選 draft-07／2019-09／2020-12，未宣告時用 draft-07；含 `ajv-formats`）。
 * ajv 在第一次驗證時才載入（獨立的 chunk），沒有用到 schema 的頁面不會下載它。
 * schema 本身不合法時，第一次驗證會 reject。
 */
export function createJsonSchemaValidator(
  schema: object | boolean,
  options: JsonSchemaValidatorOptions = {},
): JsonValidator {
  let compiled: Promise<(value: unknown) => JsonValidationError[]> | undefined;
  return async (value) => {
    compiled ??= import('./ajvValidator').then(({ compileJsonSchema }) =>
      compileJsonSchema(schema),
    );
    const errors = (await compiled)(value);
    const { formatMessage } = options;
    return formatMessage
      ? errors.map((error) => ({ ...error, message: formatMessage(error) }))
      : errors;
  };
}
