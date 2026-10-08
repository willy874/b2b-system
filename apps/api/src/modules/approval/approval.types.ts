import type { AuthUser, PermissionKey } from '@/common/types';
import type { DbOrTx, Transaction } from '@/core/database';
import type { ApprovalAssigneeKind, ApprovalAssigneeRule, ApprovalRequestRow } from '@/db/schema';
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
  /** 駁回或撤回後重新送出時，前一筆的 id（docs/architecture/backend/20-approval.md §9.9、D7）。 */
  resubmittedFrom?: string | null;
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

/**
 * `requiredPermissions()` 只看得到請求與選項：多階段在關卡啟動時以它篩選最後一關的候選人（那時還沒有審核者），
 * 設定流程時以它做反提權的檢查（那時還沒有請求，`request` 為 null；docs/architecture/backend/20-approval.md §9、D11）。
 */
export interface ApprovalPermissionContext {
  request: ApprovalRequestRow | null;
  options: ApproveOptions;
}

export interface ApprovalOutcome {
  /** 核准後產生／異動的資源 id，存回 `result_resource_id`。 */
  resourceId: string | null;
}

/**
 * 一種審批類型的業務實作，由擁有該資源的模組提供，並在 `onModuleInit` 以
 * `ApprovalService.registerHandler()` 註冊
 * （docs/architecture/backend/20-approval.md §4）。`ApprovalService` 負責狀態機、交易與稽核，
 * handler 只負責「核准之後真正要做的事」。
 */
export interface ApprovalHandler {
  readonly type: ApprovalType;
  /**
   * 除了 `approval:review` 之外，核准還需要的權限。
   * 核准等同代為執行該操作，所以審核者必須自己就做得到（反提權）。
   */
  requiredPermissions(ctx: ApprovalPermissionContext): PermissionKey[];
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
  /**
   * 這個類型支援多階段流程時提供（docs/architecture/backend/20-approval.md §9.1、D18）；沒有 = 永遠單關。
   */
  readonly flow?: ApprovalFlowSupport;
}

/** 多階段流程的支援宣告：能依哪些欄位分流由 handler 決定（D1）。 */
export interface ApprovalFlowSupport {
  /** 申請人是登入者還是匿名（註冊）。匿名的類型不能用 `manager` 規則（沒有申請人可以往上找）。 */
  requester: 'user' | 'anonymous';
  /** 條件可以用的欄位；值由 handler 從 payload 取出（payload 的形狀只有 handler 知道）。 */
  fields: readonly ApprovalConditionField[];
}

export interface ApprovalConditionField {
  key: string;
  type: 'number' | 'string' | 'enum';
  /** `enum` 的值。 */
  options?: readonly string[];
  /** 從 payload 取值；取不到回 null（條件不成立，D2）。 */
  read(payload: Record<string, unknown>): number | string | null;
}

/**
 * 審核者規則的一種（docs/architecture/backend/20-approval.md §9.2、D15）：由擁有者模組登記，`modules/approval` 不 import 它們。
 * `user`／`group`／`role` 由審批內建；`manager`／`orgUnit` 由組織管理登記。
 */
export interface ApprovalAssigneeResolver<
  Kind extends ApprovalAssigneeKind = ApprovalAssigneeKind,
> {
  readonly kind: Kind;
  /** 這個種類目前能不能用（例：組織管理未啟用 → false）；流程編輯與試算用。 */
  isAvailable(): boolean;
  /** 展開成使用者 id；找不到、已刪除、feature 未啟用一律回空陣列，不拋錯。 */
  resolve(
    rule: Extract<ApprovalAssigneeRule, { kind: Kind }>,
    ctx: { requesterId: string | null },
    tx?: DbOrTx,
  ): Promise<string[]>;
  /** 規則指到的對象的顯示名稱；對象已刪除時 `deleted`。`manager` 這種沒有對象的回 null。 */
  describe(
    rule: Extract<ApprovalAssigneeRule, { kind: Kind }>,
  ): Promise<{ label: string; deleted: boolean } | null>;
}
