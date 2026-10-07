/** 不需要 session 的頁面：SSO 的起點與 callback、IdP 的登入互動與錯誤頁、帳號流程、進入租戶。 */
const PUBLIC_PREFIXES = [
  '/login',
  '/callback',
  '/interaction',
  '/error',
  '/forgot-password',
  '/reset-password',
  '/setup',
  '/register',
  '/enter',
];

export function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
