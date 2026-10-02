import type { AnnouncementAudience } from '@/shared/api-sdk';

/** 受眾的摘要：一段一個來源（「全租戶」或「3 位使用者、2 個群組」）。 */
export function audienceSummary(
  audience: AnnouncementAudience,
): Array<{ key: string; args?: Record<string, number> }> {
  if (audience.all) return [{ key: 'announcement.audience.summary.all' }];
  const parts: Array<{ key: string; args?: Record<string, number> }> = [];
  if (audience.userIds.length) {
    parts.push({
      key: 'announcement.audience.summary.users',
      args: { count: audience.userIds.length },
    });
  }
  if (audience.groupIds.length) {
    parts.push({
      key: 'announcement.audience.summary.groups',
      args: { count: audience.groupIds.length },
    });
  }
  if (audience.roleIds.length) {
    parts.push({
      key: 'announcement.audience.summary.roles',
      args: { count: audience.roleIds.length },
    });
  }
  return parts.length ? parts : [{ key: 'announcement.audience.summary.none' }];
}
