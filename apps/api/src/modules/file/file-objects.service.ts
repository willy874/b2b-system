import { Injectable, Logger } from '@nestjs/common';

import { ObjectStorage } from '@/core/storage';
import type { FileRow } from '@/db/schema';

import { storageKeyOf, thumbnailKeyOf, variantKeyOf, variantPrefixOf } from './file.constants';

/** 一個檔案在物件儲存裡還剩下什麼（還原前檢查）。 */
export interface FileObjectProbe {
  /** 原檔：不在就無法還原（`FILE_RESTORE_CONFLICT`，`reason: 'objectMissing'`）。 */
  original: boolean;
  /** 紀錄宣稱有瀏覽器縮圖、而縮圖已不在：還原時改成沒有縮圖。 */
  thumbnailLost: boolean;
  /** 紀錄宣稱影像變體 `ready`、而變體已不在：還原時回到 `pending` 重新產生。 */
  variantsLost: boolean;
}

/** 同時發出的 HeadObject 上限：還原一個大資料夾時不一次打開上千個請求。 */
const PROBE_CONCURRENCY = 16;

/**
 * 一個檔案在物件儲存裡的所有東西：原檔、瀏覽器縮圖、影像變體（docs/architecture/backend/09-file.md §5）。
 * 刪除檔案（R4a 仍在刪除當下刪）與永久刪除（`trash.purge`）共用同一個刪法；還原前以 `probe` 確認還在
 * （docs/architecture/backend/13-trash.md §7）。
 */
@Injectable()
export class FileObjectsService {
  private readonly logger = new Logger(FileObjectsService.name);

  constructor(private readonly storage: ObjectStorage) {}

  /**
   * 刪掉一個檔案的所有物件（不存在也算成功）。失敗只記 warn、不拋出：紀錄已經刪了，留下的物件由維護排程的
   * 孤兒對帳（查不到任何紀錄的物件，§9）在永久刪除之後清掉。
   * `hints` 讓已知沒有縮圖或變體的檔案少打幾個請求（列出變體要一次 ListObjects）。
   */
  async deleteAll(
    fileId: string,
    hints: { hasThumbnail?: boolean; hasVariants?: boolean } = {},
  ): Promise<void> {
    const results = await Promise.allSettled([
      this.storage.delete(storageKeyOf(fileId)),
      hints.hasThumbnail === false ? undefined : this.storage.delete(thumbnailKeyOf(fileId)),
      hints.hasVariants === false ? undefined : this.deleteVariants(fileId),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.warn({ err: result.reason, fileId }, '物件刪除失敗，留下孤兒物件');
      }
    }
  }

  /** 還原前逐一確認物件還在（有並行上限）。回傳 id → 結果。 */
  async probe(
    rows: readonly Pick<
      FileRow,
      'id' | 'storageKey' | 'hasThumbnail' | 'variantStatus' | 'variantFormat'
    >[],
  ): Promise<Map<string, FileObjectProbe>> {
    const probes = new Map<string, FileObjectProbe>();
    for (let start = 0; start < rows.length; start += PROBE_CONCURRENCY) {
      const chunk = rows.slice(start, start + PROBE_CONCURRENCY);
      // oxlint-disable-next-line no-await-in-loop -- 一批確認完再發下一批，限制同時的請求數
      const results = await Promise.all(chunk.map((row) => this.probeOne(row)));
      chunk.forEach((row, index) => {
        const result = results[index];
        if (result) probes.set(row.id, result);
      });
    }
    return probes;
  }

  private async probeOne(
    row: Pick<FileRow, 'id' | 'storageKey' | 'hasThumbnail' | 'variantStatus' | 'variantFormat'>,
  ): Promise<FileObjectProbe> {
    const [original, thumbnail, variant] = await Promise.all([
      this.storage.head(row.storageKey),
      row.hasThumbnail ? this.storage.head(thumbnailKeyOf(row.id)) : undefined,
      // 兩個變體一起寫入、一起刪除：確認圖示預覽就夠了
      row.variantStatus === 'ready' && row.variantFormat
        ? this.storage.head(variantKeyOf(row.id, 'thumbnail', row.variantFormat))
        : undefined,
    ]);
    return {
      original: Boolean(original),
      thumbnailLost: row.hasThumbnail && !thumbnail,
      variantsLost: row.variantStatus === 'ready' && !variant,
    };
  }

  private async deleteVariants(fileId: string): Promise<void> {
    const keys: string[] = [];
    for await (const object of this.storage.listObjects(variantPrefixOf(fileId))) {
      keys.push(object.key);
    }
    await Promise.all(keys.map((key) => this.storage.delete(key)));
  }
}
