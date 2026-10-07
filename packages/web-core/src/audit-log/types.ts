/** 稽核紀錄的一列。由 app 的 adapter 從自己的 api-sdk 型別轉來。 */
export interface AuditLogRowVM {
  id: string;
  occurredAt: Date;
  actorEmail: string;
  action: string;
  /** 出現時需要特別標示的動作（例：refresh token 重用代表 token 可能外洩） */
  isHighRisk: boolean;
  /** 資源欄顯示的文字（例：`resourceType · resourceName`） */
  resourceLabel: string;
  /** 後端的結果（`data-value` 用） */
  result: string;
  isSuccess: boolean;
  errorCode: string | null;
}
