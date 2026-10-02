import type { TenantFeature } from '@/core/tenant';

/**
 * 對外事件的宣告（docs/architecture/backend/17-webhook.md §9.2 D1～D4）。純函式、不依賴 DI：擁有者模組在自己的
 * `<name>.webhooks.ts` 宣告事件與 `data` 的型別，在 `*.module.ts` 以 `WebhookEventCatalog.register()` 登記，
 * 在業務交易內呼叫 `WebhookService.emit()`。
 */

/** `data` 的值：只放 id 與列舉值（D3），所以只允許純量。 */
export type WebhookDataValue = string | number | boolean | null;

/** `data` 的形狀。擁有者以 `type` 別名宣告（`interface` 沒有隱含的索引簽章）。 */
export type WebhookData = Record<string, WebhookDataValue>;

export interface WebhookEventMeta {
  /**
   * payload 的版本（D4）：同一個版本只做相容的變更（加欄位）；不相容的變更改用新的事件名稱。
   */
  version: number;
  /** 所屬的可啟用 feature：租戶沒啟用時不出現在訂閱頁的清單（例：`file.uploaded` 屬於 `file`）。 */
  feature?: TenantFeature;
  /** `false`：系統事件（`webhook.ping`），只由「送測試事件」發出，不能訂閱。預設 `true`。 */
  subscribable?: boolean;
}

/** 一種對外事件。`D` 只用於編譯期檢查 `emit()` 的 `data`，執行期不存在。 */
export interface WebhookEventType<D extends WebhookData> {
  readonly type: string;
  readonly version: number;
  readonly feature: TenantFeature | null;
  readonly subscribable: boolean;
  /** 不會有值：只讓 `emit()` 從它推導 `data` 的型別。 */
  readonly dataType?: D;
}

/** 不論 `data` 型別的一種事件（目錄只看中繼資料）。 */
export type AnyWebhookEventType = WebhookEventType<WebhookData>;

const WEBHOOK_EVENT_PATTERN = /^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/;

/**
 * 宣告一種對外事件。名稱是 `<資源>.<過去式動詞>`（camelCase，例：`user.created`）；已發布的名稱不改名，
 * 接收端靠它分辨事件。格式不對在模組載入時就失敗。
 */
export function defineWebhookEvent<D extends WebhookData>(
  type: string,
  meta: WebhookEventMeta,
): WebhookEventType<D> {
  if (!WEBHOOK_EVENT_PATTERN.test(type)) {
    throw new Error(`對外事件 ${type} 必須是 <資源>.<動作>（camelCase，例：user.created）`);
  }
  if (!Number.isInteger(meta.version) || meta.version < 1) {
    throw new Error(`對外事件 ${type} 的版本必須是正整數`);
  }
  return {
    type,
    version: meta.version,
    feature: meta.feature ?? null,
    subscribable: meta.subscribable ?? true,
  };
}
