import type { AuditChanges, AuditMetadata, AuditResult } from '@/db/schema';

export interface AuditInput {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  resourceName?: string | null;
  result?: AuditResult;
  errorCode?: string | null;
  changes?: AuditChanges | null;
  metadata?: AuditMetadata;
  actorId?: string | null;
  actorEmail?: string;
}
