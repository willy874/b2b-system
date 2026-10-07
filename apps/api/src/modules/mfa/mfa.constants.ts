/** 登入互動的第二步可以等多久（`MfaPending` 的 TTL，docs/architecture/backend/21-mfa.md §4）。 */
export const MFA_PENDING_TTL_SECONDS = 10 * 60;
/** 同一個互動的第二步最多錯幾次，之後要從密碼重新開始（§4.2）。 */
export const MFA_PENDING_MAX_ATTEMPTS = 5;
/** 同一個 challenge 最多錯幾次（Email 驗證碼，§4.2）。 */
export const MFA_CHALLENGE_MAX_ATTEMPTS = 5;
/** 沒有確認的因子保留多久（§3：pending 的列 24 小時後清除）。 */
export const MFA_PENDING_FACTOR_TTL_MS = 24 * 60 * 60 * 1000;
/** 過期的 challenge 再保留多久才刪（調查用）。 */
export const MFA_CHALLENGE_RETENTION_MS = 24 * 60 * 60 * 1000;
export const MFA_CLEANUP_BATCH_SIZE = 1000;
