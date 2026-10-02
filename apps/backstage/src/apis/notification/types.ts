/** 列表的篩選：全部或只有未讀（`GET /notifications?unread=true`）。 */
export type NotificationFilter = 'all' | 'unread';

export interface NotificationListParams {
  filter: NotificationFilter;
  /** 每頁幾筆（後端 1～100）。 */
  limit: number;
  /** keyset 分頁的游標（上一頁的 `nextCursor`）；不帶是第一頁（最新的）。 */
  cursor?: string;
}

/** 通知總覽的篩選（`GET /notifications/all`；docs/architecture/backend/19-announcement.md §9.2 D1）。 */
export interface NotificationOverviewFilters {
  type?: string;
  recipientId?: string;
  unread?: boolean;
  /** ISO 8601；日界線由呼叫端換算（使用者偏好的時區）。 */
  from?: string;
  to?: string;
}

export interface NotificationOverviewParams extends NotificationOverviewFilters {
  limit: number;
  cursor?: string;
}
