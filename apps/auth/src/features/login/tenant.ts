import { fetchTenantLookupQuery } from '@/apis/tenant/lookup-tenant/fetcher';

/**
 * 帳號流程完成後回到那個租戶的 backstage 登入（docs/adr/0020-physical-tenant-isolation.md D11）：
 * apps/auth 自己的 `/login` 是平台管理者的登入，租戶的使用者要從租戶的網域進入。
 */
export async function goToTenantLogin(tenant: string): Promise<void> {
  const { loginUrl } = await fetchTenantLookupQuery({ params: { code: tenant } });
  globalThis.location.assign(loginUrl);
}
