import { Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';

import type { FileDto, FileUploadDto } from '../dto/file.dto';
import { FileFolderService } from '../file-folder.service';
import { FileService } from '../file.service';
import type {
  ExternalCompleteFileUploadDto,
  ExternalCreateFileUploadDto,
  ExternalCreateFileUploadPartsDto,
  ExternalFileDto,
  ExternalFileListDto,
  ExternalFileUploadDto,
  ExternalFileUploadPartsDto,
  ExternalFolderListDto,
  ListExternalFileDto,
} from './file.external.dto';

function toExternalFile(file: FileDto): ExternalFileDto {
  return {
    id: file.id,
    name: file.name,
    contentType: file.contentType,
    size: file.size,
    status: file.status,
    folderId: file.folderId,
    url: file.url,
    downloadUrl: file.downloadUrl,
    thumbnailUrl: file.thumbnailUrl,
    urlExpiresAt: file.urlExpiresAt,
    uploader: file.uploader,
    uploadedAt: file.uploadedAt,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

function toExternalUpload(upload: FileUploadDto): ExternalFileUploadDto {
  return {
    file: toExternalFile(upload.file),
    upload: upload.upload,
    multipart: upload.multipart,
  };
}

/**
 * 對外 API 的檔案端點（docs/adr/0027-api-tokens-external-api.md T3）：業務規則全部在 `FileService`、
 * `FileFolderService`（權限、資料夾授權、上傳的檢查、稽核），這裡只把內部的 DTO 換成對外的契約。
 */
@Injectable()
export class FileExternalService {
  constructor(
    private readonly files: FileService,
    private readonly folders: FileFolderService,
  ) {}

  /** 只列看得到內容的資料夾：鎖住的資料夾在後台會顯示名稱，對外不給。 */
  async listFolders(actor: AuthUser): Promise<ExternalFolderListDto> {
    const list = await this.folders.list(actor);
    return {
      items: list.items
        .filter((folder) => folder.capabilities.canRead)
        .map((folder) => ({
          id: folder.id,
          name: folder.name,
          parentId: folder.parentId,
          kind: folder.kind,
          canUpload: folder.capabilities.canCreate,
        })),
      canUploadToRoot: list.rootCapabilities.canCreate,
    };
  }

  /** 依建立時間由新到舊、以游標分頁（不提供 offset：整合方逐頁讀完，途中有人新增或刪除也不重複、不漏）。 */
  async listFiles(query: ListExternalFileDto, actor: AuthUser): Promise<ExternalFileListDto> {
    const list = await this.files.list(
      {
        offset: 0,
        limit: query.limit,
        folderId: query.folderId,
        keyword: query.keyword,
        cursor: query.cursor,
        sort: [{ sort: 'createdAt', order: 'desc' }],
      },
      actor,
    );
    return { items: list.items.map(toExternalFile), nextCursor: list.nextCursor };
  }

  async getFile(id: string, actor: AuthUser): Promise<ExternalFileDto> {
    return toExternalFile(await this.files.findOne(id, actor));
  }

  async createUpload(
    dto: ExternalCreateFileUploadDto,
    actor: AuthUser,
  ): Promise<ExternalFileUploadDto> {
    return toExternalUpload(await this.files.createUpload(dto, actor));
  }

  async createUploadParts(
    id: string,
    dto: ExternalCreateFileUploadPartsDto,
    actor: AuthUser,
  ): Promise<ExternalFileUploadPartsDto> {
    return this.files.createUploadParts(id, dto, actor);
  }

  async completeUpload(
    id: string,
    dto: ExternalCompleteFileUploadDto,
    actor: AuthUser,
  ): Promise<ExternalFileDto> {
    return toExternalFile(await this.files.completeUpload(id, dto, actor));
  }

  async abortUpload(id: string, actor: AuthUser): Promise<void> {
    await this.files.abortUpload(id, actor);
  }
}
