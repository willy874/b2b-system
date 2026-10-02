/** 稽核記錄的欄位（`diff` 只記實際改變的）。 */
export const SERVICE_ACCOUNT_AUDIT_FIELDS = ['name', 'status'] as const;

/**
 * 服務帳號的 email：`users.email` 必填且唯一，但服務帳號不收信。用 RFC 2606 保留、永遠不能投遞的 `.invalid`，
 * 寄信端另外以 `kind` 擋下（docs/architecture/06-external-api.md §9.2 D1）。
 */
export function serviceAccountEmail(id: string): string {
  return `svc-${id}@service.invalid`;
}
