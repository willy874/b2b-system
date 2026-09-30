import { Injectable, Logger } from '@nestjs/common';

import type { DbOrTx } from '@/core/database';
import { AppException } from '@/core/errors';
import { paginated } from '@/core/http';
import type { PaginatedResult } from '@/core/http';
import { SettingService } from '@/core/settings';

import type { ListRevisionDto, RevisionSummaryDto } from './dto/revision.dto';
import { REVISION_PRUNE_BATCH_SIZE, REVISION_SNAPSHOT_MAX_BYTES } from './revision.constants';
import type { RevisionResourceType } from './revision.constants';
import { RevisionRepository } from './revision.repository';
import type { RevisionSummaryRow } from './revision.repository';
import { REVISION_KEEP_DAYS_SETTING, REVISION_KEEP_VERSIONS_SETTING } from './revision.settings';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RecordRevisionInput {
  resourceType: RevisionResourceType;
  resourceId: string;
  /** 擁有者模組的白名單函式（`toRevision()`）產生的 **寫入之後** 的狀態。 */
  snapshot: Record<string, unknown>;
  /** 寫入的人；系統寫入為 null。 */
  actorId: string | null;
}

/** 單一版本（含快照）；快照超過上限而未保存時 `snapshot` 為 null。 */
export interface RevisionDetail extends RevisionSummaryDto {
  snapshot: Record<string, unknown> | null;
}

/** 一輪保留清理的結果（存成背景工作的 `output`）。 */
export interface RevisionPruneReport {
  keepVersions: number;
  keepDays: number;
  /** 早於它、而且不在最新 N 版內的版本才會被刪除。 */
  cutoff: string;
  deleted: number;
}

function toSummary(row: RevisionSummaryRow): RevisionSummaryDto {
  return {
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    actor: row.actor,
    tooLarge: row.tooLarge,
  };
}

/**
 * 版本歷史（docs/architecture/backend/14-revisions.md、ADR-0025 D1）。通用模組：不認識任何業務模組，
 * 快照的內容（白名單）、權限與版本端點都由加入的擁有者模組決定。
 */
@Injectable()
export class RevisionService {
  private readonly logger = new Logger(RevisionService.name);

  constructor(
    private readonly repo: RevisionRepository,
    private readonly settings: SettingService,
  ) {}

  /**
   * 在 **業務的交易內** 寫入下一版（與稽核同一條規則：業務與紀錄同生共死）並回傳版本號。
   * 呼叫端要先在同一個交易內鎖住實體列（`FOR UPDATE` 或已經 UPDATE 過），同一個資源的版本號才會依序產生。
   *
   * 快照超過 1 MiB 時不讓業務寫入失敗：那一版照樣佔一個版本號，`snapshot = null` 並記 warn log。
   */
  async record(tx: DbOrTx, input: RecordRevisionInput): Promise<number> {
    const bytes = Buffer.byteLength(JSON.stringify(input.snapshot), 'utf8');
    const tooLarge = bytes > REVISION_SNAPSHOT_MAX_BYTES;
    const version = await this.repo.insertNext(
      {
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        snapshot: tooLarge ? null : input.snapshot,
        actorId: input.actorId,
      },
      tx,
    );
    if (tooLarge) {
      this.logger.warn(
        { resourceType: input.resourceType, resourceId: input.resourceId, version, bytes },
        '版本快照超過上限，這一版不保存內容',
      );
    }
    return version;
  }

  /** 某個資源的版本，新的在前。資源是否存在、能不能看，由擁有者模組先確認。 */
  async list(
    resourceType: RevisionResourceType,
    resourceId: string,
    query: ListRevisionDto,
  ): Promise<PaginatedResult<RevisionSummaryDto>> {
    const { items, total } = await this.repo.list(
      resourceType,
      resourceId,
      query.offset,
      query.limit,
    );
    return paginated(items.map(toSummary), total, query);
  }

  /** 單一版本；不存在 → `404 REVISION_NOT_FOUND`（已被保留清理刪除也是）。 */
  async get(
    resourceType: RevisionResourceType,
    resourceId: string,
    version: number,
  ): Promise<RevisionDetail> {
    const row = await this.repo.find(resourceType, resourceId, version);
    if (!row) throw new AppException('REVISION_NOT_FOUND');
    return { ...toSummary(row), snapshot: row.snapshot };
  }

  /**
   * 還原用：單一版本的快照。過大未保存 → `409 REVISION_UNAVAILABLE`（沒有內容可以還原）。
   * 快照的形狀由擁有者模組以自己的 schema 驗證（舊版本的形狀可能與現在的白名單不同）。
   */
  async getSnapshot(
    resourceType: RevisionResourceType,
    resourceId: string,
    version: number,
  ): Promise<Record<string, unknown>> {
    const { snapshot } = await this.get(resourceType, resourceId, version);
    if (!snapshot) throw new AppException('REVISION_UNAVAILABLE', { version, reason: 'tooLarge' });
    return snapshot;
  }

  /** 永久刪除實體時，在同一個交易內刪掉它的所有版本。 */
  deleteAll(resourceType: RevisionResourceType, resourceId: string, tx: DbOrTx): Promise<number> {
    return this.repo.deleteAll(resourceType, resourceId, tx);
  }

  /**
   * 保留清理（ADR-0025 D1）：刪除「不在每個資源最新 `revision.keepVersions` 版內、而且早於 `revision.keepDays` 天」的版本。
   * 兩個條件是聯集的保留：只要符合其中一個就留著。每批一條 DELETE（各自提交；中途失敗重跑只剩還沒刪的）。
   */
  async prune(now: Date = new Date()): Promise<RevisionPruneReport> {
    const [keepVersions, keepDays] = await Promise.all([
      this.settings.get(REVISION_KEEP_VERSIONS_SETTING),
      this.settings.get(REVISION_KEEP_DAYS_SETTING),
    ]);
    const cutoff = new Date(now.getTime() - keepDays * DAY_MS);
    let deleted = 0;
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- 分批刪除，下一批要等這一批提交
      const count = await this.repo.pruneBatch(keepVersions, cutoff, REVISION_PRUNE_BATCH_SIZE);
      deleted += count;
      if (count < REVISION_PRUNE_BATCH_SIZE) break;
    }
    const report = { keepVersions, keepDays, cutoff: cutoff.toISOString(), deleted };
    this.logger.log(report, '版本歷史保留清理完成');
    return report;
  }
}
