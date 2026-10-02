/**
 * 到期時間的平台上限（docs/adr/0027-api-tokens-external-api.md D8）：租戶設定只能調短。
 * 沒有不過期的 token——沒有期限的 token 遲早會變成沒人知道是誰在用的 token。
 */
export const API_TOKEN_MAX_LIFETIME_DAYS = {
  human: 90,
  service: 365,
} as const;

/** 一個帳號同時有效（未撤銷、未過期）的 token 上限：防止腳本不斷建立新 token 而不撤銷。 */
export const API_TOKEN_MAX_ACTIVE_PER_ACCOUNT = 50;

/** 一把 token 最多限縮到幾個權限鍵（目錄目前 46 個）。 */
export const API_TOKEN_MAX_SCOPES = 50;
