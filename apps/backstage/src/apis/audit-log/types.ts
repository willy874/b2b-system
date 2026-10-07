export interface AuditLogListParams {
  offset: number;
  limit: number;
  /**
   * 上一頁回應的 `nextCursor`：帶了就以游標取這一頁（keyset），不送 `offset`。
   * 查詢鍵仍以 `offset` 區分頁面，同一頁不論怎麼取都是同一份快取。
   */
  cursor?: string;
  actorId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  result?: 'success' | 'failure';
  from?: string;
  to?: string;
}
