import { randomUUID } from 'node:crypto';

import { ChangeKind } from '@b2b-system/realtime';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AuthUser } from '@/common/types';
import type { Env } from '@/core/config';
import type { Database } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { paginated } from '@/core/http';
import { SettingService } from '@/core/settings';
import { ObjectStorage } from '@/core/storage';
import type { PresignedRequest } from '@/core/storage';
import { diff } from '@/modules/audit-log/audit.diff';
import { AuditService } from '@/modules/audit-log/audit.service';

import type {
  CompleteFileUploadDto,
  CreateFileUploadDto,
  CreateFileUploadPartsDto,
} from './dto/create-file-upload.dto';
import type {
  FileDto,
  FileListDto,
  FileUploadDto,
  FileUploadPartsDto,
  FileUploadPolicyDto,
} from './dto/file.dto';
import type { ListFileDto } from './dto/list-file.dto';
import type { UpdateFileDto } from './dto/update-file.dto';
import type { FileAccessContext } from './file-access.context';
import { FileAccessService } from './file-access.service';
import { FileFolderService } from './file-folder.service';
import { FileImageService } from './file-image.service';
import {
  downloadPolicyOf,
  FILE_AUDIT_FIELDS,
  fileChange,
  isImageVariantSource,
  MAX_PART_COUNT,
  storageKeyOf,
  THUMBNAIL_CONTENT_TYPES,
  THUMBNAIL_MAX_SIZE,
  thumbnailKeyOf,
} from './file.constants';
import { decodeFileCursor, encodeFileCursor } from './file.cursor';
import type { FileCursor } from './file.cursor';
import type { FileWithUploader } from './file.repository';
import { FileRepository } from './file.repository';
import { FILE_UPLOAD_MAX_SIZE_SETTING } from './file.settings';

/**
 * 檔案的業務規則（docs/architecture/backend/09-file.md）。
 *
 * 上傳分兩步：`createUpload` 登記一筆 `pending` 並發 presigned PUT（大檔改為分塊上傳，
 * 各塊的網址由 `createUploadParts` 邊傳邊發）→ 瀏覽器直傳到物件儲存 →
 * `completeUpload` 向物件儲存確認後改成 `ready`。檔案內容從不經過 api，大檔也不佔 api 的頻寬與記憶體。
 * 圖片完成後另外排入產生影像變體（`FileImageService`，§5.4）。
 */
@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);
  private readonly urlTtl: number;
  private readonly multipartThreshold: number;
  private readonly partSize: number;

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: FileRepository,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
    private readonly images: FileImageService,
    private readonly folders: FileFolderService,
    private readonly access: FileAccessService,
    private readonly settings: SettingService,
    config: ConfigService<Env, true>,
  ) {
    this.urlTtl = config.get('FILE_URL_TTL', { infer: true });
    this.multipartThreshold = config.get('FILE_MULTIPART_THRESHOLD', { infer: true });
    // 塊數不能超過 S3 的 10000：檔案上限很大時自動放大每塊的大小（依部署上限算，租戶調小不影響）
    this.partSize = Math.max(
      config.get('FILE_MULTIPART_PART_SIZE', { infer: true }),
      Math.ceil(config.get('FILE_UPLOAD_MAX_SIZE', { infer: true }) / MAX_PART_COUNT),
    );
  }

  /** 前端上傳前的檢查與切塊策略（`GET /files/upload-policy`）。 */
  async getUploadPolicy(): Promise<FileUploadPolicyDto> {
    return {
      maxSize: await this.maxSize(),
      multipartThreshold: this.multipartThreshold,
      partSize: this.partSize,
      thumbnailMaxSize: THUMBNAIL_MAX_SIZE,
      thumbnailContentTypes: [...THUMBNAIL_CONTENT_TYPES],
    };
  }

  /**
   * 帶 `cursor` 是 keyset 分頁（無限捲動），否則是 offset 分頁。兩種都回 `nextCursor`，
   * 所以 offset 模式的第一頁也能直接接著用游標往下捲。
   * 只列看得到的資料夾裡的檔案（docs/rbac/07-resource-grants.md §5.2）。
   */
  async list(query: ListFileDto, actor: AuthUser): Promise<FileListDto> {
    let after: FileCursor | undefined;
    if (query.cursor) {
      after = decodeFileCursor(query.cursor);
      const [primary] = query.sort;
      if (!after || after.sort.sort !== primary?.sort || after.sort.order !== primary.order) {
        throw new AppException('VALIDATION_FAILED', { field: 'cursor' });
      }
    }
    const ctx = await this.access.contextFor(actor);
    const scope = await this.listScope(ctx, actor, query.folderId);
    const { items, total, lastCreatedAt } = await this.repo.list(query, after, scope);
    const dtos = await Promise.all(items.map((file) => this.toDto(file, ctx)));
    // 帶游標的頁不計總數（null）：無限捲動每捲一頁就重算一次 count(*) 太貴
    const page =
      total === null
        ? { items: dtos, pagination: { offset: 0, limit: query.limit, total: null } }
        : paginated(dtos, total, query);

    const last = items.at(-1);
    const [sort] = after ? [after.sort] : query.sort;
    const nextCursor =
      last && sort && items.length === query.limit
        ? encodeFileCursor({
            sort,
            value:
              sort.sort === 'createdAt'
                ? (lastCreatedAt ?? last.createdAt.toISOString())
                : sort.sort === 'name'
                  ? last.name
                  : last.size,
            id: last.id,
          })
        : null;
    return { ...page, nextCursor };
  }

  /**
   * `pending` 的檔案只有上傳者本人看得到（其他人眼中它還不存在）；
   * `ready` 的要看得到所在的資料夾。
   */
  async findOne(id: string, actor: AuthUser): Promise<FileDto> {
    const ctx = await this.access.contextFor(actor);
    return this.toDto(await this.getVisible(id, actor, ctx), ctx);
  }

  async createUpload(dto: CreateFileUploadDto, actor: AuthUser): Promise<FileUploadDto> {
    const maxSize = await this.maxSize();
    if (dto.size > maxSize) {
      throw new AppException('FILE_TOO_LARGE', { maxSize, size: dto.size });
    }
    const ctx = await this.access.contextFor(actor);
    await this.access.assertCan(ctx, actor, 'create', dto.folderId ?? null);
    await this.storage.ensureBucket();

    const id = randomUUID();
    const storageKey = storageKeyOf(id);
    const isMultipart = dto.size > this.multipartThreshold;
    // 分塊上傳先向物件儲存要 uploadId，失敗就不留下 pending 紀錄
    const uploadId = isMultipart
      ? await this.storage.createMultipartUpload(storageKey, { contentType: dto.contentType })
      : null;
    const row = await this.folders.insideFolder(dto.folderId, (tx) =>
      this.repo.create(
        {
          id,
          name: dto.name,
          contentType: dto.contentType,
          size: dto.size,
          storageKey,
          uploadId,
          folderId: dto.folderId ?? null,
          status: 'pending',
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        tx,
      ),
    );

    const [upload, thumbnailUpload] = await Promise.all([
      isMultipart
        ? undefined
        : this.storage.presignUpload(storageKey, {
            contentType: dto.contentType,
            expiresIn: this.urlTtl,
          }),
      dto.thumbnail
        ? this.storage.presignUpload(thumbnailKeyOf(id), {
            contentType: dto.thumbnail.contentType,
            expiresIn: this.urlTtl,
          })
        : undefined,
    ]);

    // 回應裡的 uploader 就是自己；不為了顯示名稱再查一次
    const file = await this.toDto({ ...row, uploader: null }, ctx);
    return {
      file,
      upload: upload ? toUploadTarget(upload) : null,
      multipart: isMultipart
        ? { partSize: this.partSize, partCount: Math.max(1, Math.ceil(dto.size / this.partSize)) }
        : null,
      thumbnailUpload: thumbnailUpload ? toUploadTarget(thumbnailUpload) : null,
    };
  }

  /** 分塊上傳：發出指定各塊的直傳網址。只有上傳者本人、還沒完成的分塊上傳可以要。 */
  async createUploadParts(
    id: string,
    dto: CreateFileUploadPartsDto,
    actor: AuthUser,
  ): Promise<FileUploadPartsDto> {
    const file = await this.getOwnPending(id, actor);
    const { uploadId } = file;
    if (!uploadId) throw new AppException('FILE_UPLOAD_PART_INVALID', { reason: 'not-multipart' });
    const partCount = Math.max(1, Math.ceil(file.size / this.partSize));
    const outOfRange = dto.partNumbers.filter((partNumber) => partNumber > partCount);
    if (outOfRange.length > 0) {
      throw new AppException('FILE_UPLOAD_PART_INVALID', { partCount, outOfRange });
    }

    const parts = await Promise.all(
      dto.partNumbers.map(async (partNumber) => {
        const signed = await this.storage.presignUploadPart(file.storageKey, uploadId, partNumber, {
          expiresIn: this.urlTtl,
        });
        return { partNumber, url: signed.url, method: 'PUT' as const, headers: signed.headers };
      }),
    );
    return {
      parts,
      expiresAt: new Date(Date.now() + this.urlTtl * 1000).toISOString(),
    };
  }

  async completeUpload(id: string, dto: CompleteFileUploadDto, actor: AuthUser): Promise<FileDto> {
    const ctx = await this.access.contextFor(actor);
    const file = await this.getVisible(id, actor, ctx);
    if (file.status === 'ready') throw new AppException('FILE_ALREADY_UPLOADED');
    // 上傳途中被移除授權：不讓它變成看得到的檔案（放棄上傳仍然可以）
    await this.access.assertCan(ctx, actor, 'create', file.folderId);

    if (file.uploadId) {
      if (!dto.parts) {
        throw new AppException('FILE_UPLOAD_PART_INVALID', { reason: 'parts-required' });
      }
      // 各塊的完整性由物件儲存檢查（缺塊、ETag 不符 → FILE_UPLOAD_INCOMPLETE）
      const parts = dto.parts.toSorted((a, b) => a.partNumber - b.partNumber);
      try {
        await this.storage.completeMultipartUpload(file.storageKey, file.uploadId, parts);
      } catch (error) {
        // 物件儲存那一側已經組好了，uploadId 因此失效（NoSuchUpload）：並行的另一個 complete 先組好、
        // 或上次組好之後在 markReady 前中斷。物件在、大小對就照常完成，否則原樣拋出
        if (!(error instanceof AppException && error.code === 'FILE_UPLOAD_INCOMPLETE'))
          throw error;
        const assembled = await this.storage.head(file.storageKey);
        if (assembled?.size !== file.size) throw error;
      }
    }

    const [stored, thumbnail] = await Promise.all([
      this.storage.head(file.storageKey),
      this.storage.head(thumbnailKeyOf(id)),
    ]);
    if (!stored) throw new AppException('FILE_UPLOAD_INCOMPLETE');
    if (stored.size !== file.size) {
      // 刪掉不符的內容：單次 PUT 可以用同一個網址（未過期時）重傳；
      // 分塊上傳的 uploadId 在組合後就失效了，只能放棄這次上傳、重新登記
      await this.storage.delete(file.storageKey);
      throw new AppException('FILE_SIZE_MISMATCH', { expected: file.size, actual: stored.size });
    }
    // 縮圖只是加分：不存在或不合規格就當作沒有，不讓上傳失敗
    const hasThumbnail = Boolean(
      thumbnail &&
      thumbnail.size <= THUMBNAIL_MAX_SIZE &&
      (THUMBNAIL_CONTENT_TYPES as readonly string[]).includes(thumbnail.contentType ?? ''),
    );
    const hasVariants = isImageVariantSource(file.contentType);

    await withTransaction(this.db, async (tx) => {
      const updated = await this.repo.markReady(
        id,
        {
          size: stored.size,
          etag: stored.etag,
          uploadedAt: new Date(),
          hasThumbnail,
          variantStatus: hasVariants ? 'pending' : 'none',
          updatedBy: actor.id,
        },
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

    // 不等變體產生完：回應先帶瀏覽器縮圖（有的話）。圖片的 create 推播交給變體產生：
    // 變體很快就好時「完成」與「變體好了」合併成一次推播
    if (hasVariants) this.images.schedule(id, { announce: { folderId: file.folderId } });
    else this.publish(ChangeKind.CREATE, id, file.folderId);
    return this.findOne(id, actor);
  }

  /**
   * 放棄上傳（使用者取消、或前端放棄重試）：清掉分塊、已上傳的內容與縮圖，紀錄軟刪除。
   * `pending` 從未對其他人可見，所以不寫稽核、不發推播。已完成的上傳回 `FILE_ALREADY_UPLOADED`。
   */
  async abortUpload(id: string, actor: AuthUser): Promise<void> {
    const file = await this.getOwnPending(id, actor);
    const discarded = await this.repo.discardPending(id, actor.id);
    // 並行的 complete 搶先完成了：這個檔案已經是 ready，不能當成放棄的上傳刪掉
    if (!discarded) throw new AppException('FILE_ALREADY_UPLOADED');

    const cleanups = [
      file.uploadId ? this.storage.abortMultipartUpload(file.storageKey, file.uploadId) : undefined,
      this.storage.delete(file.storageKey),
      this.storage.delete(thumbnailKeyOf(id)),
    ];
    const results = await Promise.allSettled(cleanups);
    if (results.some((result) => result.status === 'rejected')) {
      this.logger.warn({ fileId: id }, '放棄上傳時清除物件失敗，留下孤兒物件');
    }
  }

  async update(id: string, dto: UpdateFileDto, actor: AuthUser): Promise<FileDto> {
    const { file, ctx } = await this.getModifiable(id, actor, 'update');
    if (dto.version !== undefined && dto.version !== file.version) {
      throw new AppException('FILE_VERSION_CONFLICT', { current: file.version });
    }
    const changes = diff(file, { name: dto.name }, FILE_AUDIT_FIELDS);
    if (!changes) return this.toDto(file, ctx);

    await withTransaction(this.db, async (tx) => {
      const updated = await this.repo.update(
        id,
        { name: dto.name, updatedBy: actor.id },
        dto.version,
        tx,
      );
      // 讀到之後、寫入之前被別人改名（版本變了）或刪除：重讀一次，還在就帶目前的版本（ADR-0025 D3）
      if (!updated) {
        const current = dto.version === undefined ? undefined : await this.repo.findVersion(id, tx);
        throw current === undefined
          ? new AppException('FILE_NOT_FOUND')
          : new AppException('FILE_VERSION_CONFLICT', { current });
      }
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

    this.publish(ChangeKind.UPDATE, id, file.folderId);
    return this.findOne(id, actor);
  }

  async remove(id: string, actor: AuthUser): Promise<void> {
    const { file } = await this.getModifiable(id, actor, 'delete');

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
    const results = await Promise.allSettled([
      this.storage.delete(file.storageKey),
      file.hasThumbnail ? this.storage.delete(thumbnailKeyOf(id)) : undefined,
      file.variantStatus === 'none' ? undefined : this.images.deleteVariants(id),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.warn({ err: result.reason, fileId: id }, '物件刪除失敗，留下孤兒物件');
      }
    }
    this.publish(ChangeKind.DELETE, id, file.folderId);
  }

  /** 別人的 `pending`、看不到所在資料夾的 `ready`：一律當作不存在。 */
  private async getVisible(
    id: string,
    actor: AuthUser,
    ctx: FileAccessContext,
  ): Promise<FileWithUploader> {
    const file = await this.repo.findById(id);
    const visible =
      file &&
      (file.status === 'pending' ? file.createdBy === actor.id : ctx.can('read', file.folderId));
    if (!visible) throw new AppException('FILE_NOT_FOUND');
    return file;
  }

  /** 上傳者本人、還在上傳中的檔案；已完成回 `FILE_ALREADY_UPLOADED`。 */
  private async getOwnPending(id: string, actor: AuthUser): Promise<FileWithUploader> {
    const file = await this.repo.findById(id);
    if (!file || file.createdBy !== actor.id) throw new AppException('FILE_NOT_FOUND');
    if (file.status === 'ready') throw new AppException('FILE_ALREADY_UPLOADED');
    return file;
  }

  /**
   * 改名、刪除只對已完成上傳、看得到的檔案（還在上傳中的視為不存在）；
   * 能不能做看所在的資料夾與擁有者規則（docs/rbac/07-resource-grants.md §4）。
   */
  private async getModifiable(
    id: string,
    actor: AuthUser,
    action: 'update' | 'delete',
  ): Promise<{ file: FileWithUploader; ctx: FileAccessContext }> {
    const [file, ctx] = await Promise.all([this.repo.findById(id), this.access.contextFor(actor)]);
    if (!file || file.status !== 'ready' || !ctx.can('read', file.folderId)) {
      throw new AppException('FILE_NOT_FOUND');
    }
    if (!ctx.canModify(action, file.folderId, file.createdBy)) {
      throw await this.access.deny(actor, action, 'file', id);
    }
    return { file, ctx };
  }

  /**
   * 列表的範圍：持有全域 `file:read` 不限；否則只有讀得到的資料夾，根目錄是空的（§5.2）。
   * 指定了不存在的資料夾回 404、鎖住的回 403。
   */
  private async listScope(
    ctx: FileAccessContext,
    actor: AuthUser,
    folderId: ListFileDto['folderId'],
  ): Promise<{ folderIds: readonly string[] } | undefined> {
    if (folderId && folderId !== 'root') {
      await this.access.assertCan(ctx, actor, 'read', folderId);
    }
    const readable = ctx.readableFolderIds();
    return readable ? { folderIds: readable } : undefined;
  }

  /** 租戶設定的單檔上限；設定的 schema 已限制它不超過 env 的上限。 */
  private maxSize(): Promise<number> {
    return this.settings.get(FILE_UPLOAD_MAX_SIZE_SETTING);
  }

  private publish(kind: ChangeKind, id: string, folderId: string | null): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [fileChange(kind, id, folderId)],
    });
  }

  private async toDto(file: FileWithUploader, ctx: FileAccessContext): Promise<FileDto> {
    // 白名單以外的型別不在租戶網域上 inline 顯示：`url` 也是 attachment（§7.2）
    const policy = downloadPolicyOf(file.contentType);
    const links =
      file.status === 'ready'
        ? await Promise.all([
            this.storage.presignDownload(file.storageKey, {
              expiresIn: this.urlTtl,
              fileName: file.name,
              disposition: policy.disposition,
              contentType: policy.contentType,
            }),
            this.storage.presignDownload(file.storageKey, {
              expiresIn: this.urlTtl,
              fileName: file.name,
              disposition: 'attachment',
              contentType: policy.contentType,
            }),
            file.hasThumbnail
              ? this.storage.presignDownload(thumbnailKeyOf(file.id), {
                  expiresIn: this.urlTtl,
                  fileName: file.name,
                  disposition: 'inline',
                })
              : undefined,
          ])
        : undefined;
    const image = this.images.signedUrls(file);
    const expiresAt = links
      ?.flatMap((link) => (link ? [link.expiresAt.getTime()] : []))
      .concat(image ? [Date.parse(image.expiresAt)] : [])
      .reduce((min, time) => Math.min(min, time));
    return {
      id: file.id,
      name: file.name,
      contentType: file.contentType,
      size: file.size,
      status: file.status,
      folderId: file.folderId,
      url: links?.[0].url ?? null,
      downloadUrl: links?.[1].url ?? null,
      thumbnailUrl: image?.thumbnailUrl ?? links?.[2]?.url ?? null,
      image,
      urlExpiresAt: expiresAt === undefined ? null : new Date(expiresAt).toISOString(),
      version: file.version,
      uploader: file.uploader,
      capabilities: ctx.fileCapabilities(file),
      uploadedAt: file.uploadedAt?.toISOString() ?? null,
      createdAt: file.createdAt.toISOString(),
      updatedAt: file.updatedAt.toISOString(),
    };
  }
}

function toUploadTarget(signed: PresignedRequest) {
  return {
    url: signed.url,
    method: 'PUT' as const,
    headers: signed.headers,
    expiresAt: signed.expiresAt.toISOString(),
  };
}
