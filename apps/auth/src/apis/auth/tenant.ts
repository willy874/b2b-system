/**
 * apps/auth 不屬於任何租戶：帳號流程（啟用、重設密碼、註冊）以 `X-Tenant` 指定是哪個租戶的帳號
 * （docs/adr/0020-physical-tenant-isolation.md 開放問題 6）。租戶代碼來自信中連結或登入互動頁的 `?tenant=`。
 */
export interface TenantScoped {
  tenant: string;
}

export function tenantHeaders(tenant: string): HeadersInit {
  return { 'x-tenant': tenant };
}
