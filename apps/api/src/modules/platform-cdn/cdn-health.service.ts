import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { JobQueue } from '@/core/jobs';
import { cdnCheckFailures, cdnEdgeKidMismatch, cdnEdgeUp } from '@/core/metrics';
import { CdnConfig, encodeCdnPath, NginxCdnEdgePurger, nginxCdnSignature } from '@/core/storage';
import type { CdnDeployment } from '@/core/storage';
import type { CdnCheckNode, CdnCheckResult } from '@/db/platform/schema';

import { classifyPublicUrl, classifyTamperedUrl, evaluateNode, isReady } from './cdn-check';
import { CDN_CHECK_PATH_PREFIX, CDN_HEALTH_CHECK_JOB } from './platform-cdn.constants';
import { PlatformCdnRepository } from './platform-cdn.repository';

/** 手動檢查在這段時間內重複呼叫回上一次的結果（docs/architecture/backend/09-file.md §16.10）。 */
export const CDN_CHECK_REUSE_MS = 10_000;

/** 指標只回報這段時間內的結果：程序久沒跑檢查（另一個 worker 接手了）就不再回報舊的狀態。 */
const GAUGE_FRESHNESS_MS = 15 * 60_000;

/** 竄改的簽章：把最後一個字元換掉（base64url 的字母表內）。 */
function tamper(sig: string): string {
  const last = sig.at(-1);
  return `${sig.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
}

/**
 * 邊緣的檢查（docs/architecture/backend/09-file.md §16.10）：手動（`POST /platform/cdn/check`、開啟前）與定期（`cdn.healthCheck`）共用。
 *
 * 1. 每個節點連得到、2. 清理密鑰被接受、3. 節點有 api 簽發中的 kid：清理端點（`FILE_CDN_PURGE_URL`）解析出的每個位址各 `GET /_status`。
 * 4. 對外網址可用、5. 竄改的簽章會被拒：以 api 的身分簽一個 **不存在** 的路徑向 `FILE_CDN_ORIGIN` 請求，以 `X-CDN-Reject` 區分邊緣的拒絕與源站的回應
 *    （不需要任何租戶的物件，也不在快取留下內容，§17 D17）。
 *
 * 結果寫進 `cdn_settings.last_check`。同一個程序同一時間只跑一次。
 */
@Injectable()
export class CdnHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CdnHealthService.name);
  private readonly cron: string | undefined;
  private running?: Promise<CdnCheckResult>;
  private last?: { result: CdnCheckResult; at: number };
  private readonly unobserve: Array<() => void> = [];

  constructor(
    private readonly config: CdnConfig,
    private readonly repo: PlatformCdnRepository,
    private readonly jobs: JobQueue,
    env: ConfigService<Env, true>,
  ) {
    this.cron = config.isDeployed
      ? env.get('FILE_CDN_HEALTH_CHECK_CRON', { infer: true }) || undefined
      : undefined;
  }

  onModuleInit(): void {
    // 不論部署都註冊（工作名稱固定出現在 OpenAPI 的 `JobName`）；沒有 CDN 時不排程
    this.jobs.register(CDN_HEALTH_CHECK_JOB, () => this.runScheduled(), { cron: this.cron });
    this.unobserve.push(
      cdnEdgeUp.observe(this, (report) => {
        for (const node of this.freshNodes()) {
          report({ node: node.address }, node.problems.some(isConnectivityProblem) ? 0 : 1);
        }
      }),
      cdnEdgeKidMismatch.observe(this, (report) => {
        for (const node of this.freshNodes()) {
          report({ node: node.address }, node.problems.includes('signingKidMissing') ? 1 : 0);
        }
      }),
    );
  }

  onModuleDestroy(): void {
    for (const stop of this.unobserve) stop();
  }

  /** 定期檢查；沒有部署 CDN 的程序遇到時略過（排程只在部署時建立，這是入列之後才關掉的情況）。 */
  async runScheduled(): Promise<CdnCheckResult | { skipped: string }> {
    if (!this.config.isDeployed) return { skipped: 'CDN_NOT_DEPLOYED' };
    return this.check({ reuseWithinMs: 0 });
  }

  /**
   * 執行檢查並寫進 `last_check`。`reuseWithinMs` 內有上一次的結果就直接回它；同時呼叫的共用同一次檢查。
   * 只能在部署了 CDN 時呼叫。
   */
  async check({ reuseWithinMs = CDN_CHECK_REUSE_MS } = {}): Promise<CdnCheckResult> {
    if (this.last && Date.now() - this.last.at < reuseWithinMs) return this.last.result;
    this.running ??= this.runOnce().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async runOnce(): Promise<CdnCheckResult> {
    const deployment = this.config.deployment;
    if (!deployment) throw new Error('沒有部署 CDN：不能執行邊緣的檢查');
    const result = await this.inspect(deployment);
    this.record(result);
    this.last = { result, at: Date.now() };
    try {
      await this.repo.saveCheck(result);
    } catch (error) {
      // 結果照樣回給呼叫端（開啟前的檢查不因為寫入失敗而誤判）；頁面下次讀到的是上一次的結果
      this.logger.error({ err: error }, '寫入 CDN 檢查的結果失敗');
    }
    return result;
  }

  private async inspect(deployment: CdnDeployment): Promise<CdnCheckResult> {
    const kids = kidsOf(deployment);
    let discovery: CdnCheckResult['discovery'] = { ok: true };
    let nodes: CdnCheckNode[] = [];
    if (!deployment.purgeUrl || !deployment.purgeSecret) {
      discovery = { ok: false, problem: 'purgeNotConfigured' };
    } else {
      const edge = new NginxCdnEdgePurger({
        purgeUrl: deployment.purgeUrl,
        secret: deployment.purgeSecret,
        timeoutMs: deployment.purgeTimeoutMs,
      });
      try {
        nodes = (await edge.status()).map((status) => evaluateNode(status, kids));
      } catch (error) {
        discovery = {
          ok: false,
          problem: 'resolveFailed',
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    }
    const [publicUrl, signatureEnforced] = await this.probePublicUrl(deployment);
    return {
      checkedAt: new Date().toISOString(),
      ready: isReady(discovery.ok, nodes),
      discovery,
      nodes,
      publicUrl,
      signatureEnforced,
    };
  }

  /** 項目 4、5：簽一個不存在的路徑，正確的簽章預期源站的 404，竄改的簽章預期邊緣的 403。 */
  private async probePublicUrl(
    deployment: CdnDeployment,
  ): Promise<[CdnCheckResult['publicUrl'], CdnCheckResult['signatureEnforced']]> {
    const path = `${CDN_CHECK_PATH_PREFIX}/${randomUUID()}`;
    const exp = Math.floor(Date.now() / 1000) + 300;
    const { kid, key } = deployment.signingKeys.signing;
    const sig = nginxCdnSignature(key, path, exp);
    const urlOf = (signature: string) =>
      `${deployment.origin}${encodeCdnPath(path)}?exp=${exp}&kid=${encodeURIComponent(kid)}&sig=${signature}`;

    const valid = await this.request(urlOf(sig), deployment.purgeTimeoutMs);
    const publicUrl: CdnCheckResult['publicUrl'] =
      'error' in valid
        ? { result: 'unreachable', detail: valid.error }
        : { result: classifyPublicUrl(valid.status, valid.reject), status: valid.status };
    const tampered = await this.request(urlOf(tamper(sig)), deployment.purgeTimeoutMs);
    const signatureEnforced: CdnCheckResult['signatureEnforced'] =
      'error' in tampered
        ? { result: 'unreachable', detail: tampered.error }
        : {
            result: classifyTamperedUrl(tampered.status, tampered.reject),
            status: tampered.status,
          };
    return [publicUrl, signatureEnforced];
  }

  private async request(
    url: string,
    timeoutMs: number,
  ): Promise<{ status: number; reject: string | null } | { error: string }> {
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      // 本體用不到：讀掉讓連線可以重用
      await response.arrayBuffer().catch(() => undefined);
      return { status: response.status, reject: response.headers.get('x-cdn-reject') };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  private record(result: CdnCheckResult): void {
    if (!result.discovery.ok) cdnCheckFailures.inc({ item: 'discovery' });
    for (const node of result.nodes) {
      if (node.problems.some(isConnectivityProblem)) cdnCheckFailures.inc({ item: 'node' });
      if (node.problems.includes('purgeSecretRejected'))
        cdnCheckFailures.inc({ item: 'purgeSecret' });
      if (node.problems.includes('signingKidMissing')) cdnCheckFailures.inc({ item: 'kid' });
    }
    if (result.publicUrl.result !== 'ok') cdnCheckFailures.inc({ item: 'publicUrl' });
    if (result.signatureEnforced.result === 'notEnforced') {
      cdnCheckFailures.inc({ item: 'signatureEnforced' });
      this.logger.error('CDN 的邊緣沒有驗簽章：任何人都能從快取讀到內容');
    }
    if (!result.ready) {
      this.logger.warn(
        {
          discovery: result.discovery,
          nodes: result.nodes.map(({ address, problems }) => ({ address, problems })),
        },
        'CDN 的邊緣檢查沒有通過',
      );
    }
  }

  private freshNodes(): CdnCheckNode[] {
    if (!this.last || Date.now() - this.last.at > GAUGE_FRESHNESS_MS) return [];
    return this.last.result.nodes;
  }
}

/** 節點連不上或不認得這個 api（清理密鑰不同、不是這一版的邊緣）：`api_cdn_edge_up = 0`。 */
function isConnectivityProblem(problem: string): boolean {
  return (
    problem === 'unreachable' ||
    problem === 'timeout' ||
    problem === 'purgeSecretRejected' ||
    problem === 'badResponse'
  );
}

/** api 的金鑰環的 kid：簽發中的在第一個。 */
export function kidsOf(deployment: Pick<CdnDeployment, 'signingKeys'>): string[] {
  const signing = deployment.signingKeys.signing.kid;
  return [signing, ...[...deployment.signingKeys.byKid.keys()].filter((kid) => kid !== signing)];
}
