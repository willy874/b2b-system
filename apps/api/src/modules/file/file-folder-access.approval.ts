import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import type { AuthUser, PermissionKey } from '@/common/types';
import type { Transaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import type { ApprovalRequestRow } from '@/db/schema';
import { ApprovalType } from '@/modules/approval/approval.constants';
import { ApprovalService } from '@/modules/approval/approval.service';
import type {
  ApprovalContext,
  ApprovalHandler,
  ApprovalOutcome,
  SubmitApprovalInput,
} from '@/modules/approval/approval.types';
import { AuditService } from '@/modules/audit-log/audit.service';
import type { NotificationLink } from '@/modules/notification/notification.definition';

import { FILE_ACTION_PERMISSION } from './file-access.context';
import { FileAccessService } from './file-access.service';
import { FileFolderGrantRepository } from './file-folder-grant.repository';
import { FileFolderRepository } from './file-folder.repository';
import { GRANT_LEVELS, levelRank } from './file-grant.levels';
import type { GrantLevel } from './file-grant.levels';

/** 審核者看得到的申請內容。 */
export const FileFolderAccessPayloadSchema = z.object({
  folderId: z.string().uuid(),
  folderName: z.string(),
  level: z.enum(GRANT_LEVELS),
});
export type FileFolderAccessPayload = z.infer<typeof FileFolderAccessPayloadSchema>;

/** 去重鍵：同一個人對同一個資料夾同時只有一筆待審；前綴 `<folderId>:` 查該資料夾的所有申請。 */
export function fileFolderAccessSubjectKey(folderId: string, userId = ''): string {
  return `${folderId}:${userId}`;
}

/** 申請資料夾存取 → 一筆 `fileFolder.access` 審批請求。 */
export function fileFolderAccessRequest(
  folder: { id: string; name: string },
  level: GrantLevel,
  requester: AuthUser,
  reason: string | undefined,
): SubmitApprovalInput {
  return {
    type: ApprovalType.FILE_FOLDER_ACCESS,
    subjectKey: fileFolderAccessSubjectKey(folder.id, requester.id),
    payload: {
      folderId: folder.id,
      folderName: folder.name,
      level,
    } satisfies FileFolderAccessPayload,
    requester: { id: requester.id, name: requester.email },
    reason: reason || null,
  };
}

/**
 * `fileFolder.access` 的核准（docs/rbac/06-approval.md §7）：審核者代為授予申請的等級。
 * 審核權限是資源層級的——審核者要在該資料夾 `share`、授予得起該等級（反提權）——
 * 所以 `requiredPermissions()` 為空，檢查在 `assertApprovable()`。審批頁與檔案管理器兩個入口共用。
 */
@Injectable()
export class FileFolderAccessApprovalHandler implements ApprovalHandler, OnModuleInit {
  readonly type = ApprovalType.FILE_FOLDER_ACCESS;

  constructor(
    private readonly approvals: ApprovalService,
    private readonly access: FileAccessService,
    private readonly folders: FileFolderRepository,
    private readonly grants: FileFolderGrantRepository,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
  ) {}

  onModuleInit(): void {
    this.approvals.registerHandler(this);
  }

  requiredPermissions(): PermissionKey[] {
    return [];
  }

  async assertApprovable({ request, reviewer }: ApprovalContext): Promise<void> {
    const payload = FileFolderAccessPayloadSchema.parse(request.payload);
    if (!(await this.folders.findById(payload.folderId))) {
      throw new AppException('FILE_FOLDER_NOT_FOUND', { folderId: payload.folderId });
    }
    if (!request.requesterId || !(await this.grants.subjectExists('user', request.requesterId))) {
      throw new AppException('FILE_GRANT_SUBJECT_NOT_FOUND', { subjectType: 'user' });
    }
    const ctx = await this.access.contextFor(reviewer);
    if (!ctx.can('share', payload.folderId)) {
      throw await this.access.deny(reviewer, 'share', 'fileFolder', payload.folderId);
    }
    const missing = ctx.missingActions([payload.level], payload.folderId);
    if (missing.length > 0) {
      throw new AppException('AUTHZ_ESCALATION', {
        missing: missing.map((action) => FILE_ACTION_PERMISSION[action]),
      });
    }
  }

  async apply({ request, reviewer }: ApprovalContext, tx: Transaction): Promise<ApprovalOutcome> {
    const payload = FileFolderAccessPayloadSchema.parse(request.payload);
    const requesterId = request.requesterId ?? '';
    const key = {
      folderId: payload.folderId,
      subjectType: 'user' as const,
      subjectId: requesterId,
    };
    const before = await this.grants.find(key, tx);
    // 已經有更高的直接授權（例如申請之後被手動授予）：不降級
    const level =
      before && levelRank(before.level) > levelRank(payload.level) ? before.level : payload.level;
    await this.grants.set(key, { level, expiresAt: null, grantedBy: reviewer.id }, tx);
    await this.audit.record(
      {
        action: 'fileFolder.grant',
        resourceType: 'fileFolder',
        resourceId: payload.folderId,
        resourceName: payload.folderName,
        changes: {
          before: before
            ? { subjectType: 'user', subjectId: requesterId, level: before.level }
            : null,
          after: { subjectType: 'user', subjectId: requesterId, level },
        },
        metadata: { approvalId: request.id },
      },
      tx,
    );
    return { resourceId: payload.folderId };
  }

  async afterApply(_: ApprovalContext, outcome: ApprovalOutcome): Promise<void> {
    if (!outcome.resourceId) return;
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [
        { resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.UPDATE, id: outcome.resourceId },
      ],
    });
  }

  /** 申請的資料夾名稱（申請當下的快照）。 */
  summarize(payload: Record<string, unknown>): string {
    const parsed = FileFolderAccessPayloadSchema.safeParse(payload);
    return parsed.success ? parsed.data.folderName : '';
  }

  /**
   * 申請人通常沒有 `approval:read`：結果通知連到申請的資料夾（前端的檔案管理器 `?folder=`）。
   * 被駁回時點進去照常經過權限檢查（看不到就是 403），與審批詳情一樣不授予任何東西（docs/architecture/backend/15-notification.md §12.2 D5）。
   */
  resultLink(request: ApprovalRequestRow): NotificationLink | null {
    const parsed = FileFolderAccessPayloadSchema.safeParse(request.payload);
    return parsed.success
      ? { route: 'file.folder', params: { folderId: parsed.data.folderId } }
      : null;
  }
}
