/**
 * 權限鍵的字串形狀：`camelCaseResource:camelCaseAction`。
 * 實際的鍵清單由後端定義，經 OpenAPI 傳到 `@game-editor/api-sdk`。
 */
export type PermissionKeyString = `${string}:${string}`;

const PERMISSION_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*:[a-z][a-zA-Z0-9]*$/;

export function isPermissionKeyString(value: string): value is PermissionKeyString {
  return PERMISSION_KEY_PATTERN.test(value);
}

export function parsePermissionKey(key: string): { resource: string; action: string } {
  const [resource, action] = key.split(':');
  if (!resource || !action) {
    throw new Error(`Invalid permission key: ${key}`);
  }
  return { resource, action };
}
