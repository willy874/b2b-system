import { containsContext, emailContext, PasswordSchema } from '@/modules/credential/password';

/**
 * 環境變數提供的初始管理者密碼要符合與登入相同的密碼政策（docs/architecture/backend/04-auth.md §4.2）：
 * 至少 12 字元、不是常見密碼、不含 email 的片段。不符合就讓 seed 失敗，不靜默換成隨機密碼——
 * 換掉之後沒有人知道新密碼，而平台管理者沒有自助的忘記密碼（docs/architecture/iam/05-bootstrap.md §5.1）。
 */
export function assertSeedPassword(password: string, email: string, variable: string): void {
  if (
    PasswordSchema.safeParse(password).success &&
    !containsContext(password, emailContext(email))
  ) {
    return;
  }
  throw new Error(
    `${variable} 不符合密碼政策（至少 12 字元、不是常見密碼、不含 email 的片段）：請改用更強的密碼，或留空改走隨機密碼／設定連結`,
  );
}
