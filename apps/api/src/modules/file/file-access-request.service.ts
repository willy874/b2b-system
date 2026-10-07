import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { ApprovalType } from '@/modules/approval/approval.constants';
import { ApprovalService } from '@/modules/approval/approval.service';

import type {
  CreateFileAccessRequestDto,
  FileAccessRequestListDto,
  ReviewFileAccessRequestDto,
} from './dto/file-access-request.dto';
import { FileAccessService } from './file-access.service';
import {
  FileFolderAccessPayloadSchema,
  fileFolderAccessRequest,
  fileFolderAccessSubjectKey,
} from './file-folder-access.approval';
import { FileFolderGrantService } from './file-folder-grant.service';
import { FileFolderRepository } from './file-folder.repository';

/**
 * 資料夾的存取申請（docs/architecture/iam/06-resource-grants.md §6.5）：送出、該資料夾管理者的待審清單、核准／駁回。
 * 狀態機與稽核在審批模組；這裡只把「資料夾管理者」這個資源層級的審核者接上去。
 */
@Injectable()
export class FileAccessRequestService {
  constructor(
    private readonly approvals: ApprovalService,
    private readonly access: FileAccessService,
    private readonly folders: FileFolderRepository,
    private readonly grantService: FileFolderGrantService,
    private readonly events: DomainEventBus,
  ) {}

  /** 已經有這個等級 → `FILE_ACCESS_ALREADY_GRANTED`；已有待審 → 不另建（`submitted: false`）。 */
  async submit(
    folderId: string,
    dto: CreateFileAccessRequestDto,
    actor: AuthUser,
  ): Promise<{ submitted: boolean }> {
    const folder = await this.folders.findById(folderId);
    if (!folder) throw new AppException('FILE_FOLDER_NOT_FOUND', { folderId });
    const ctx = await this.access.contextFor(actor);
    // 看不到的個人資料夾不能申請：分享由擁有者主動做（docs/architecture/iam/06-resource-grants.md §12.1）
    if (!ctx.exists(folderId)) throw new AppException('FILE_FOLDER_NOT_FOUND', { folderId });
    if (ctx.missingActions([dto.level], folderId).length === 0) {
      throw new AppException('FILE_ACCESS_ALREADY_GRANTED', { level: dto.level });
    }
    const created = await this.approvals.submit(
      fileFolderAccessRequest(folder, dto.level, actor, dto.reason),
    );
    // 資料夾的管理者不一定在審批的受眾裡：以資料夾變更通知他們（與申請人自己的「申請中」）
    if (created) this.publish(folderId);
    return { submitted: Boolean(created) };
  }

  /** 操作者自己有待審申請的資料夾（資料夾清單的 `hasPendingAccessRequest`）。 */
  async pendingFolderIdsOf(actor: AuthUser): Promise<Set<string>> {
    const pending = await this.approvals.listPendingBy(ApprovalType.FILE_FOLDER_ACCESS, {
      requesterId: actor.id,
    });
    return new Set(
      pending.flatMap((request) => {
        const payload = FileFolderAccessPayloadSchema.safeParse(request.payload);
        return payload.success ? [payload.data.folderId] : [];
      }),
    );
  }

  async list(folderId: string, actor: AuthUser): Promise<FileAccessRequestListDto> {
    const ctx = await this.access.contextFor(actor);
    await this.grantService.assertCanShare(ctx, actor, folderId);
    const pending = await this.approvals.listPendingBy(ApprovalType.FILE_FOLDER_ACCESS, {
      subjectKeyPrefix: fileFolderAccessSubjectKey(folderId),
    });
    return {
      items: pending.flatMap((request) => {
        const payload = FileFolderAccessPayloadSchema.safeParse(request.payload);
        if (!payload.success) return [];
        return [
          {
            id: request.id,
            requesterId: request.requesterId,
            requesterName: request.requesterName,
            level: payload.data.level,
            reason: request.reason,
            createdAt: request.createdAt,
          },
        ];
      }),
    };
  }

  /** 核准：handler 另外檢查 share 與反提權（同一套規則也用在審批頁）。 */
  async approve(
    folderId: string,
    requestId: string,
    dto: ReviewFileAccessRequestDto,
    actor: AuthUser,
  ): Promise<void> {
    await this.assertReviewable(folderId, requestId, actor);
    await this.approvals.approve(requestId, { roleIds: [], comment: dto.comment }, actor);
  }

  async reject(
    folderId: string,
    requestId: string,
    dto: ReviewFileAccessRequestDto,
    actor: AuthUser,
  ): Promise<void> {
    await this.assertReviewable(folderId, requestId, actor);
    await this.approvals.reject(requestId, { comment: dto.comment }, actor);
    this.publish(folderId);
  }

  /** 操作者能管理這個資料夾的授權，而且這筆是這個資料夾、還在待審的存取申請。 */
  private async assertReviewable(
    folderId: string,
    requestId: string,
    actor: AuthUser,
  ): Promise<void> {
    const ctx = await this.access.contextFor(actor);
    await this.grantService.assertCanShare(ctx, actor, folderId);
    // 不存在（APPROVAL_NOT_FOUND）與「不是這個資料夾的」一樣回 FILE_ACCESS_REQUEST_NOT_FOUND
    const request = await this.approvals.findOne(requestId).catch((error: unknown) => {
      if (error instanceof AppException) return undefined;
      throw error;
    });
    const payload = FileFolderAccessPayloadSchema.safeParse(request?.payload);
    const matches =
      request?.type === ApprovalType.FILE_FOLDER_ACCESS &&
      request.status === 'pending' &&
      payload.success &&
      payload.data.folderId === folderId;
    if (!matches) throw new AppException('FILE_ACCESS_REQUEST_NOT_FOUND', { requestId });
  }

  private publish(folderId: string): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.UPDATE, id: folderId }],
    });
  }
}
