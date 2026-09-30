/**
 * 通知類型的宣告與輸入（docs/architecture/backend/15-notification.md §3、ADR-0026 D2）。
 * 純函式、不依賴 DI：擁有者模組在自己的 `<name>.notifications.ts` 宣告類型與參數型別，
 * 在業務交易內以 `notification()` 組出輸入交給 `NotificationService.notify()`。
 */

/** 通知參數的值：只放顯示需要的名稱快照（ADR-0026 D1），所以只允許純量與字串陣列。 */
export type NotificationParamValue = string | number | boolean | null | readonly string[];

/**
 * 參數的形狀。擁有者模組以 `type` 別名宣告（`interface` 沒有隱含的索引簽章，指定不給這個約束）。
 */
export type NotificationParams = Record<string, NotificationParamValue>;

/**
 * 連結：前端的 route id ＋ 參數（ADR-0026 D3）。route id 是穩定的字串（`<feature>.<頁面>`），
 * 前端的 feature 在 plugin 的同步階段註冊它對應的 route；清單見 15-notification.md §4。
 */
export interface NotificationLink {
  route: string;
  params: Record<string, string>;
}

/** 一種通知。`P` 只用於編譯期檢查 `type` 與 `params` 的配對，執行期不存在。 */
export interface NotificationType<P extends NotificationParams> {
  readonly type: string;
  /** 不會有值：只讓 `notification()` 從它推導參數型別。 */
  readonly paramsType?: P;
}

/** 交給 `NotificationService.notify()` 的一筆（每位收件人一筆，ADR-0026 D1）。 */
export interface NotificationInput {
  type: string;
  recipientId: string;
  /** 觸發的人；null＝系統。等於收件人時不通知（D7）。 */
  actorId: string | null;
  params: NotificationParams;
  link: NotificationLink | null;
}

const NOTIFICATION_TYPE_PATTERN = /^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/;
const ROUTE_ID_PATTERN = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/;

/**
 * 宣告一種通知。名稱是 `<模組>.<事件>`（camelCase，與 `defineJob` 同一種命名）；
 * 格式不對在模組載入時就失敗，不會等到第一次寫入。
 */
export function defineNotification<P extends NotificationParams>(
  type: string,
): NotificationType<P> {
  if (!isNotificationType(type)) {
    throw new Error(`通知類型 ${type} 必須是 <模組>.<事件>（camelCase，例：approval.pending）`);
  }
  return { type };
}

export function isNotificationType(type: string): boolean {
  return NOTIFICATION_TYPE_PATTERN.test(type);
}

/** 前端的 route id 格式：`<feature>.<頁面>`（可再多層），例：`approval.detail`。 */
export function isRouteId(route: string): boolean {
  return ROUTE_ID_PATTERN.test(route);
}

/** 組一筆通知；`params` 的型別由 `kind` 決定，配錯在編譯期就失敗。 */
export function notification<P extends NotificationParams>(
  kind: NotificationType<P>,
  input: {
    recipientId: string;
    actorId: string | null;
    params: P;
    link?: NotificationLink | null;
  },
): NotificationInput {
  return {
    type: kind.type,
    recipientId: input.recipientId,
    actorId: input.actorId,
    params: input.params,
    link: input.link ?? null,
  };
}
