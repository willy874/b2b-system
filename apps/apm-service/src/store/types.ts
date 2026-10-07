/** 存進 `.data/events/` 的一筆錯誤事件（已遮罩、已截斷）。欄位名稱沿用 Sentry 的事件格式。 */
export interface StoredFrame {
  filename?: string;
  abs_path?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

export interface StoredException {
  type: string;
  value: string;
  mechanism?: { type?: string; handled?: boolean };
  /** 由外而內（Sentry 的慣例：最後一個是最內層的呼叫）。 */
  frames: StoredFrame[];
}

export interface StoredBreadcrumb {
  timestamp?: number;
  category?: string;
  type?: string;
  level?: string;
  message?: string;
  data?: Record<string, string | number | boolean>;
}

export interface StoredEvent {
  eventId: string;
  /** 專案 slug。 */
  project: string;
  /** fingerprint 的雜湊；查詢 API 的 issue id（設計決策 D8）。 */
  groupId: string;
  title: string;
  /** 最內層、屬於 app 的那一層（壓縮後的名稱，查詢時以 sourcemap 還原）。 */
  culprit: string;
  level: string;
  platform: string;
  /** ISO 8601；事件發生的時間（SDK 的 `timestamp`）。 */
  timestamp: string;
  /** ISO 8601；apm-service 收到的時間。 */
  receivedAt: string;
  release?: string;
  environment?: string;
  /** 頁面的 path 樣板（`/user/$userId`）。 */
  transaction?: string;
  message?: string;
  exceptions: StoredException[];
  breadcrumbs: StoredBreadcrumb[];
  tags: Record<string, string>;
  /** 只有 id（設計決策 D7）。 */
  user?: { id: string };
  userAgent?: string;
  /** 只留 path。 */
  url?: string;
  sdk?: { name?: string; version?: string };
}
