import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { defineJob, JobQueue } from '../jobs';
import type { JobContext } from '../jobs';
import { cdnPurgeFailures, cdnPurgePaths, cdnPurgeRequests } from '../metrics';
import { requireTenant } from '../tenant';
import { CdnConfig } from './cdn-config';
import { NginxCdnEdgePurger } from './cdn-edge-purger';
import type { CdnPurgeNodeResult, CdnPurgeTarget } from './cdn-edge-purger';
import { cdnPathOf } from './cdn-url-signer';

/**
 * 清理邊緣快取（docs/architecture/backend/09-file.md §16.6）。資料是邊緣上的完整路徑（`/storage/<bucket>/<key>`），
 * 所以是平台工作：不必進入租戶，也不佔租戶的同時執行上限。重試 5 次、30 秒起指數退避（清理是冪等的）。
 */
/** 手動清理的來源（apps/platform 的 CDN 頁面，docs/architecture/backend/09-file.md §16.11）：背景工作頁看得到是誰、清什麼。 */
export interface CdnManualPurge {
  /** 平台管理者的 id。 */
  requestedBy: string;
  tenantId: string | null;
  /** 目標的種類：`paths`、資源類型（`imageAsset` 等）或 `all`。 */
  target: string;
  /** 資源的 id（依資源清理時）。 */
  id?: string;
}

/** `cdn.purge` 的資料：路徑清單或整個快取；物件刪除後的自動清理沒有 `manual`。 */
export type CdnPurgeJobData = ({ paths: string[] } | { all: true }) & { manual?: CdnManualPurge };

export const CDN_PURGE_JOB = defineJob<CdnPurgeJobData>('cdn.purge', {
  scope: 'platform',
  retryLimit: 5,
  retryDelaySeconds: 30,
  expireInSeconds: 5 * 60,
});

/**
 * 物件刪除之後清理邊緣快取的入口（docs/architecture/backend/09-file.md §16.6）。擁有者模組在 **物件刪除成功之後**
 * 呼叫 `schedule(keys)`——反過來的話，清完到刪除之間有人用有效網址讀取，邊緣會把即將刪除的內容再存一次（§17 D3）。
 * 不在交易內以 outbox 入列，理由相同（outbox 可能在刪除完成前就被執行）。
 *
 * 用 abstract class 而不是 interface，是因為它同時當作 Nest 的 DI token。
 */
export abstract class CdnPurger {
  /**
   * 排入清理目前租戶的這些物件（物件 key，例：`images/<id>/r3/sm.webp`）。只列寫入後永不覆寫、可能走過 CDN 的物件；
   * 列到沒走過 CDN 的也無妨（邊緣回報 `missing`）。**不會拋錯**：入列失敗只記 error 與指標，刪除本身照常完成。
   */
  abstract schedule(keys: readonly string[]): Promise<void>;
}

/** 沒有 CDN（`FILE_CDN_ENABLED=false`）或關掉自動清理時：什麼都不做，`cdn.purge` 不入列。 */
@Injectable()
export class NoopCdnPurger extends CdnPurger {
  async schedule(): Promise<void> {
    // 沒有邊緣快取要清
  }
}

/** 依 `FILE_CDN_PURGE_BATCH_SIZE` 分批，每批一筆 `cdn.purge`。 */
@Injectable()
export class QueuedCdnPurger extends CdnPurger {
  private readonly logger = new Logger(QueuedCdnPurger.name);

  constructor(
    private readonly jobs: JobQueue,
    private readonly config: CdnConfig,
  ) {
    super();
  }

  async schedule(keys: readonly string[]): Promise<void> {
    // 生效值每次都問 CdnConfig：執行期的設定可以不重啟就關掉自動清理（docs/architecture/backend/09-file.md §16.9）
    if (keys.length === 0 || !this.config.purgeOnDelete()) return;
    let paths: string[];
    try {
      const bucket = requireTenant().storageBucket;
      paths = [...new Set(keys)].map((key) => cdnPathOf(bucket, key));
    } catch (error) {
      cdnPurgeFailures.inc({ stage: 'schedule' });
      this.logger.error(
        { err: error, keys: keys.length },
        '無法排入邊緣快取的清理（沒有租戶脈絡）',
      );
      return;
    }
    const size = this.config.purgeBatchSize();
    for (let start = 0; start < paths.length; start += size) {
      const batch = paths.slice(start, start + size);
      try {
        // oxlint-disable-next-line no-await-in-loop -- 批次數很少；依序入列讓失敗的那一批記得清楚
        await this.jobs.enqueue(CDN_PURGE_JOB, { paths: batch });
      } catch (error) {
        cdnPurgeFailures.inc({ stage: 'schedule' });
        this.logger.error(
          { err: error, paths: batch.length },
          '排入邊緣快取的清理失敗：刪掉的物件在網址的剩餘效期內仍可從邊緣讀到',
        );
      }
    }
  }
}

/** `cdn.purge` 的 output（管理頁看得到）；整個快取時 `paths` 是 `'all'`。 */
export interface CdnPurgeJobOutput {
  paths: number | 'all';
  nodes: CdnPurgeNodeResult[];
}

/**
 * `cdn.purge` 的 handler：送到每一個邊緣節點，全部成功才算完成；任一節點失敗就整筆重試。
 * 不論 CDN 開關都註冊（工作名稱固定出現在 OpenAPI 的 `JobName`）；沒有清理端點的程序遇到時略過。
 */
@Injectable()
export class CdnPurgeJob implements OnModuleInit {
  private readonly logger = new Logger(CdnPurgeJob.name);
  private readonly edge: NginxCdnEdgePurger | undefined;

  constructor(
    private readonly jobs: JobQueue,
    config: CdnConfig,
  ) {
    const deployment = config.deployment;
    this.edge =
      deployment?.purgeUrl && deployment.purgeSecret
        ? new NginxCdnEdgePurger({
            purgeUrl: deployment.purgeUrl,
            secret: deployment.purgeSecret,
            timeoutMs: deployment.purgeTimeoutMs,
          })
        : undefined;
  }

  onModuleInit(): void {
    this.jobs.register(CDN_PURGE_JOB, (data, context) => this.run(data, context));
  }

  async run(
    data: CdnPurgeJobData,
    context: Pick<JobContext, 'retryCount' | 'signal'>,
  ): Promise<CdnPurgeJobOutput | { skipped: string }> {
    const target: CdnPurgeTarget = 'all' in data ? { all: true } : { paths: data.paths };
    const count = 'all' in target ? ('all' as const) : target.paths.length;
    if (!this.edge) {
      // 入列之後 CDN 被關掉（或這個程序沒有清理端點）：沒有能清的對象
      this.logger.warn({ paths: count }, '沒有設定邊緣的清理端點，略過 cdn.purge');
      return { skipped: 'CDN_PURGE_NOT_CONFIGURED' };
    }
    let nodes: CdnPurgeNodeResult[];
    try {
      nodes = await this.edge.purge(target, context.signal);
    } catch (error) {
      // DNS 解析失敗等：一個節點都沒送到
      cdnPurgeRequests.inc({ result: 'error' });
      this.recordIfFinal(context);
      throw error;
    }
    for (const node of nodes) cdnPurgeRequests.inc({ result: node.result });
    const failed = nodes.filter((node) => node.result !== 'ok');
    if (failed.length > 0) {
      this.recordIfFinal(context);
      throw new Error(
        `邊緣快取的清理失敗（${failed.length}/${nodes.length} 個節點）：` +
          failed.map((node) => `${node.address} ${node.detail ?? node.result}`).join('、'),
      );
    }
    if (count !== 'all') cdnPurgePaths.inc(count);
    return { paths: count, nodes };
  }

  private recordIfFinal(context: Pick<JobContext, 'retryCount'>): void {
    if (context.retryCount < CDN_PURGE_JOB.options.retryLimit) return;
    cdnPurgeFailures.inc({ stage: 'final' });
    this.logger.error('邊緣快取的清理重試用完：刪掉的物件在網址的剩餘效期內仍可從邊緣讀到');
  }
}
