/** 不需要 session 的頁面：SSO 的起點與 callback。 */
export function isPublic(pathname: string): boolean {
  return pathname === '/auth' || pathname.startsWith('/auth/');
}
