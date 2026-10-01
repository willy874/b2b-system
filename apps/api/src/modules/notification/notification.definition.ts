import type { TenantFeature } from '@/core/tenant';

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

/** 送達的管道（ADR-0028）：站內通知與寄信。 */
export const NotificationChannel = {
  IN_APP: 'inApp',
  EMAIL: 'email',
} as const;

export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NOTIFICATION_CHANNELS = [
  NotificationChannel.IN_APP,
  NotificationChannel.EMAIL,
] as const;

/** 事件管理用的中繼資料（docs/architecture/backend/16-notification-event.md §1、ADR-0028 D1）。 */
export interface NotificationEventMeta {
  /** 管理頁的分組（camelCase，通常是擁有者模組的名稱）。 */
  category: string;
  /** 這個事件 **能** 經由的管道；租戶只能在其中開關。 */
  channels: readonly NotificationChannel[];
  /** 租戶沒有覆寫時是否送出。預設 `true`。 */
  defaultEnabled?: boolean;
  /** 不能關（安全事件）：租戶與個人都改不了（D4）。預設 `false`。 */
  mandatory?: boolean;
  /** 所屬的可啟用 feature：租戶沒啟用時不出現在管理頁（D11）。 */
  feature?: TenantFeature;
}

/** 一種通知。`P` 只用於編譯期檢查 `type` 與 `params` 的配對，執行期不存在。 */
export interface NotificationType<P extends NotificationParams> {
  readonly type: string;
  readonly category: string;
  readonly channels: readonly NotificationChannel[];
  readonly defaultEnabled: boolean;
  readonly mandatory: boolean;
  readonly feature: TenantFeature | null;
  /** 不會有值：只讓 `notification()` 從它推導參數型別。 */
  readonly paramsType?: P;
}

/** 不論參數型別的一種通知（目錄、政策只看中繼資料）。 */
export type AnyNotificationType = NotificationType<NotificationParams>;

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
const CATEGORY_PATTERN = /^[a-z][A-Za-z0-9]*$/;
const ROUTE_ID_PATTERN = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/;

/**
 * 宣告一種通知。名稱是 `<模組>.<事件>`（camelCase，與 `defineJob` 同一種命名）；
 * 格式或中繼資料不對在模組載入時就失敗，不會等到第一次寫入。
 * 宣告之後還要在擁有者的 `*.module.ts` 以 `NotificationEventCatalog.register()` 登記（ADR-0028 D2）。
 */
export function defineNotification<P extends NotificationParams>(
  type: string,
  meta: NotificationEventMeta,
): NotificationType<P> {
  if (!isNotificationType(type)) {
    throw new Error(`通知類型 ${type} 必須是 <模組>.<事件>（camelCase，例：approval.pending）`);
  }
  if (!CATEGORY_PATTERN.test(meta.category)) {
    throw new Error(`通知類型 ${type} 的分類 ${meta.category} 必須是 camelCase`);
  }
  if (!meta.channels.length || new Set(meta.channels).size !== meta.channels.length) {
    throw new Error(`通知類型 ${type} 的管道不可為空或重複`);
  }
  const defaultEnabled = meta.defaultEnabled ?? true;
  const mandatory = meta.mandatory ?? false;
  // 不能關的事件預設卻是關的：永遠不會送出，也沒有人能打開
  if (mandatory && !defaultEnabled) {
    throw new Error(`通知類型 ${type} 是 mandatory，defaultEnabled 不可為 false`);
  }
  return {
    type,
    category: meta.category,
    channels: [...meta.channels],
    defaultEnabled,
    mandatory,
    feature: meta.feature ?? null,
  };
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
