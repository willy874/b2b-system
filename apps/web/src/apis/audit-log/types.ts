export interface AuditLogListParams {
  offset: number;
  limit: number;
  actorId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  result?: 'success' | 'failure';
  from?: string;
  to?: string;
}
