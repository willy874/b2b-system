import type { AuthUser, PermissionKey } from '@/common/types';
import type { Transaction } from '@/core/database';
import type { ApprovalRequestRow } from '@/db/schema';
import type { NotificationLink } from '@/modules/notification/notification.definition';

import type { ApprovalType } from './approval.constants';

/** 送出一筆審批請求。 */
export interface SubmitApprovalInput {
  type: ApprovalType;
  /** 同類型同對象的去重鍵：已有一筆待審時不再建立新的。 */
  subjectKey: string;
  /** 審核者看得到的內容。 */
  payload: Record<string, unknown>;
  /** 只給 handler 用、永不回傳也不進稽核的內容；審核後清空。 */
  privatePayload?: Record<string, unknown>;
  /** 匿名請求（註冊）的 `id` 為 null。 */
  requester: { id: string | null; name: string };
  reason?: string | null;
}

/** 核准時審核者可以附帶的選項（依類型解讀；不適用的類型忽略）。 */
export interface ApproveOptions {
  /** `user.register`：核准時一併指派的角色。 */
  roleIds: string[];
}

export interface ApprovalContext {
  request: ApprovalRequestRow;
  reviewer: AuthUser;
  options: ApproveOptions;
}

export interface ApprovalOutcome {
  /** 核准後產生／異動的資源 id，存回 `result_resource_id`。 */
  resourceId: string | null;
}

/**
 * 一種審批類型的業務實作，由擁有該資源的模組提供，並在 `onModuleInit` 以
 * `ApprovalService.registerHandler()` 註冊
 * （docs/rbac/06-approval.md §4）。`ApprovalService` 負責狀態機、交易與稽核，
 * handler 只負責「核准之後真正要做的事」。
 */
export interface ApprovalHandler {
  readonly type: ApprovalType;
  /**
   * 除了 `approval:review` 之外，核准還需要的權限。
   * 核准等同代為執行該操作，所以審核者必須自己就做得到（反提權）。
   */
  requiredPermissions(ctx: ApprovalContext): PermissionKey[];
  /** 交易前的業務檢查（重複、反提權）；不通過就拋 `AppException`。 */
  assertApprovable(ctx: ApprovalContext): Promise<void>;
  /** 在審批狀態更新的同一個交易內套用變更（含該變更自己的稽核）。 */
  apply(ctx: ApprovalContext, tx: Transaction): Promise<ApprovalOutcome>;
  /** 交易提交後的副作用：快取失效、領域事件。 */
  afterApply(ctx: ApprovalContext, outcome: ApprovalOutcome): Promise<void>;
  /**
   * 站內通知用的一行摘要（名稱快照，不含敏感資料）：`payload` 是審核者看得到的內容。
   * 解析不了（舊資料的形狀）時回傳空字串，前端只顯示類型。
   */
  summarize(payload: Record<string, unknown>): string;
  /**
   * 審批結果通知給申請人的連結。不提供時連到審批詳情（`approval.detail`）；
   * 申請人通常沒有 `approval:read`，能連到自己看得到的頁面時由 handler 決定（例：申請的資料夾）。
   */
  resultLink?(request: ApprovalRequestRow): NotificationLink | null;
}
