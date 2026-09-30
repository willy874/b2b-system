/** 列表的篩選：全部或只有未讀（`GET /notifications?unread=true`）。 */
export type NotificationFilter = 'all' | 'unread';

export interface NotificationListParams {
  filter: NotificationFilter;
  /** 每頁幾筆（後端 1～100）。 */
  limit: number;
  /** keyset 分頁的游標（上一頁的 `nextCursor`）；不帶是第一頁（最新的）。 */
  cursor?: string;
}
