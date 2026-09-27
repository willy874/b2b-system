import { randomUUID } from 'node:crypto';

import { ChangeKind, ChangeSource } from '@game-editor/realtime';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AuthUser } from '@/common/types';
import type { Env } from '@/core/config';
import type { Database } from '@/core/database';
import { DRIZZLE, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { paginated } from '@/core/http';
import { ObjectStorage } from '@/core/storage';
import { diff } from '@/modules/audit-log/audit.diff';
import { AuditService } from '@/modules/audit-log/audit.service';

import type { CreateFileUploadDto } from './dto/create-file-upload.dto';
import type { FileDto, FileUploadDto } from './dto/file.dto';
import type { ListFileDto } from './dto/list-file.dto';
import type { UpdateFileDto } from './dto/update-file.dto';
import { FILE_AUDIT_FIELDS, storageKeyOf } from './file.constants';
import type { FileWithUploader } from './file.repository';
import { FileRepository } from './file.repository';

/**
 * 檔案的業務規則（docs/architecture/backend/09-file.md）。
 *
 * 上傳分兩步：`createUpload` 登記一筆 `pending` 並發 presigned PUT →
 * 瀏覽器直傳到物件儲存 → `completeUpload` 向物件儲存確認後改成 `ready`。
 * 檔案內容從不經過 api，大檔也不佔 api 的頻寬與記憶體。
 */
@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);
  private readonly maxSize: number;
  private readonly urlTtl: number;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly repo: FileRepository,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
    config: ConfigService<Env, true>,
  ) {
    this.maxSize = config.get('FILE_UPLOAD_MAX_SIZE', { infer: true });
    this.urlTtl = config.get('FILE_URL_TTL', { infer: true });
  }

  async list(query: ListFileDto) {
    const { items, total } = await this.repo.list(query);
    return paginated(await Promise.all(items.map((file) => this.toDto(file))), total, query);
  }

  /** `pending` 的檔案只有上傳者本人看得到（其他人眼中它還不存在）。 */
  async findOne(id: string, actor: AuthUser): Promise<FileDto> {
    return this.toDto(await this.getVisible(id, actor));
  }

  async createUpload(dto: CreateFileUploadDto, actor: AuthUser): Promise<FileUploadDto> {
    if (dto.size > this.maxSize) {
      throw new AppException('FILE_TOO_LARGE', { maxSize: this.maxSize, size: dto.size });
    }
    await this.storage.ensureBucket();

    const id = randomUUID();
    const storageKey = storageKeyOf(id);
    const row = await this.repo.create({
      id,
      name: dto.name,
      contentType: dto.contentType,
      size: dto.size,
      storageKey,
      status: 'pending',
      createdBy: actor.id,
      updatedBy: actor.id,
    });
    const upload = await this.storage.presignUpload(storageKey, {
      contentType: dto.contentType,
      expiresIn: this.urlTtl,
    });

    // 回應裡的 uploader 就是自己；不為了顯示名稱再查一次
    const file = await this.toDto({ ...row, uploader: null });
    return {
      file,
      upload: {
        url: upload.url,
        method: 'PUT',
        headers: upload.headers,
        expiresAt: upload.expiresAt.toISOString(),
      },
    };
  }

  async completeUpload(id: string, actor: AuthUser): Promise<FileDto> {
    const file = await this.getVisible(id, actor);
    if (file.status === 'ready') throw new AppException('FILE_ALREADY_UPLOADED');

    const stored = await this.storage.head(file.storageKey);
    if (!stored) throw new AppException('FILE_UPLOAD_INCOMPLETE');
    if (stored.size !== file.size) {
      // 刪掉不符的內容，讓使用者能用同一個網址（未過期時）重傳
      await this.storage.delete(file.storageKey);
      throw new AppException('FILE_SIZE_MISMATCH', { expected: file.size, actual: stored.size });
    }

    await withTransaction(this.db, async (tx) => {
      const updated = await this.repo.markReady(
        id,
        { size: stored.size, etag: stored.etag, uploadedAt: new Date(), updatedBy: actor.id },
        tx,
      );
      if (!updated) throw new AppException('FILE_ALREADY_UPLOADED');
      await this.audit.record(
        {
          action: 'file.upload',
          resourceType: 'file',
          resourceId: id,
          resourceName: file.name,
          changes: {
            after: { name: file.name, contentType: file.contentType, size: stored.size },
          },
        },
        tx,
      );
    });

    this.publish(ChangeKind.CREATE, id);
    return this.findOne(id, actor);
  }

  async update(id: string, dto: UpdateFileDto, actor: AuthUser): Promise<FileDto> {
    const file = await this.getReady(id);
    const changes = diff(file, dto, FILE_AUDIT_FIELDS);
    if (!changes) return this.toDto(file);

    await withTransaction(this.db, async (tx) => {
      const updated = await this.repo.update(id, { name: dto.name, updatedBy: actor.id }, tx);
      if (!updated) throw new AppException('FILE_NOT_FOUND');
      await this.audit.record(
        {
          action: 'file.update',
          resourceType: 'file',
          resourceId: id,
          resourceName: dto.name,
          changes,
        },
        tx,
      );
    });

    this.publish(ChangeKind.UPDATE, id);
    return this.findOne(id, actor);
  }

  async remove(id: string, actor: AuthUser): Promise<void> {
    const file = await this.getReady(id);

    await withTransaction(this.db, async (tx) => {
      const deleted = await this.repo.softDelete(id, actor.id, tx);
      if (!deleted) throw new AppException('FILE_NOT_FOUND');
      await this.audit.record(
        {
          action: 'file.delete',
          resourceType: 'file',
          resourceId: id,
          resourceName: file.name,
          changes: { before: { name: file.name, contentType: file.contentType, size: file.size } },
        },
        tx,
      );
    });

    // 內容在交易「之後」才刪：交易 rollback 時紀錄還在，內容也要在。
    // 刪除失敗只留下孤兒物件（紀錄已不可見），不讓使用者的刪除失敗。
    try {
      await this.storage.delete(file.storageKey);
    } catch (error) {
      this.logger.warn({ err: error, fileId: id }, '物件刪除失敗，留下孤兒物件');
    }
    this.publish(ChangeKind.DELETE, id);
  }

  private async getVisible(id: string, actor: AuthUser): Promise<FileWithUploader> {
    const file = await this.repo.findById(id);
    if (!file || (file.status === 'pending' && file.createdBy !== actor.id)) {
      throw new AppException('FILE_NOT_FOUND');
    }
    return file;
  }

  /** 改名、刪除只對已完成上傳的檔案；還在上傳中的視為不存在。 */
  private async getReady(id: string): Promise<FileWithUploader> {
    const file = await this.repo.findById(id);
    if (!file || file.status !== 'ready') throw new AppException('FILE_NOT_FOUND');
    return file;
  }

  private publish(kind: ChangeKind, id: string): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.FILE, kind, id }],
    });
  }

  private async toDto(file: FileWithUploader): Promise<FileDto> {
    const links =
      file.status === 'ready'
        ? await Promise.all([
            this.storage.presignDownload(file.storageKey, {
              expiresIn: this.urlTtl,
              fileName: file.name,
              disposition: 'inline',
            }),
            this.storage.presignDownload(file.storageKey, {
              expiresIn: this.urlTtl,
              fileName: file.name,
              disposition: 'attachment',
            }),
          ])
        : undefined;
    return {
      id: file.id,
      name: file.name,
      contentType: file.contentType,
      size: file.size,
      status: file.status,
      url: links?.[0].url ?? null,
      downloadUrl: links?.[1].url ?? null,
      urlExpiresAt: links?.[0].expiresAt.toISOString() ?? null,
      uploader: file.uploader,
      uploadedAt: file.uploadedAt?.toISOString() ?? null,
      createdAt: file.createdAt.toISOString(),
      updatedAt: file.updatedAt.toISOString(),
    };
  }
}
