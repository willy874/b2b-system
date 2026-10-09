import type { CdnEdgeStatusResult } from '@/core/storage';
import type {
  CdnCheckNode,
  CdnCheckResult,
  CdnNodeProblem,
  CdnPublicUrlResult,
  CdnSignatureCheckResult,
} from '@/db/platform/schema';

/**
 * 開啟前必須通過的問題（docs/architecture/backend/09-file.md §16.10 的項目 1～3）：任一節點有其中一種，就不能開啟 CDN
 * 或加入資源類型（§17 D14）。`verifyKidMissing`（輪替中）只警告。
 */
export const BLOCKING_NODE_PROBLEMS: ReadonlySet<CdnNodeProblem> = new Set([
  'unreachable',
  'timeout',
  'purgeSecretRejected',
  'badResponse',
  'signingKidMissing',
]);

/** 一個節點的 `/_status` → 檢查結果；`kids` 是 api 的金鑰環（第一把簽發）。 */
export function evaluateNode(status: CdnEdgeStatusResult, kids: readonly string[]): CdnCheckNode {
  const empty = { kids: null, missingKids: [], cache: null, build: null, startedAt: null };
  switch (status.result) {
    case 'ok': {
      const nodeKids = new Set(status.status.kids);
      const missingKids = kids.filter((kid) => !nodeKids.has(kid));
      const problems: CdnNodeProblem[] = [];
      if (kids[0] !== undefined && missingKids.includes(kids[0]))
        problems.push('signingKidMissing');
      if (missingKids.some((kid) => kid !== kids[0])) problems.push('verifyKidMissing');
      return {
        address: status.address,
        problems,
        kids: status.status.kids,
        missingKids,
        cache: status.status.cache,
        build: status.status.build || null,
        startedAt: status.status.startedAt || null,
      };
    }
    case 'rejected':
      return {
        address: status.address,
        problems: ['purgeSecretRejected'],
        ...empty,
        detail: status.detail,
      };
    case 'invalid':
      return {
        address: status.address,
        problems: ['badResponse'],
        ...empty,
        detail: status.detail,
      };
    case 'timeout':
      return { address: status.address, problems: ['timeout'], ...empty, detail: status.detail };
    default:
      return {
        address: status.address,
        problems: ['unreachable'],
        ...empty,
        detail: status.detail,
      };
  }
}

/** 節點都沒有開啟前的問題，而且至少有一個節點。 */
export function isReady(discoveryOk: boolean, nodes: readonly CdnCheckNode[]): boolean {
  return (
    discoveryOk &&
    nodes.length > 0 &&
    nodes.every((node) => !node.problems.some((problem) => BLOCKING_NODE_PROBLEMS.has(problem)))
  );
}

/** 對外網址的回應（項目 4）：不存在的路徑 → 預期源站的 404；`reject` 是邊緣的 `X-CDN-Reject`。 */
export function classifyPublicUrl(status: number, reject: string | null): CdnPublicUrlResult {
  if (status === 404) return 'ok';
  if (status === 403) return reject ? 'signatureRejected' : 'originAuthRejected';
  if (status === 502 || status === 504) return 'originUnreachable';
  return 'unexpected';
}

/** 竄改簽章的回應（項目 5）：預期 `403` 與 `X-CDN-Reject: signature`；放行到源站（404）就是沒有驗簽章。 */
export function classifyTamperedUrl(
  status: number,
  reject: string | null,
): CdnSignatureCheckResult {
  if (status === 403 && reject === 'signature') return 'ok';
  if (status === 404 || (status >= 200 && status < 300)) return 'notEnforced';
  return 'unexpected';
}

/** 頁面與 409 的 `details.nodes`：只列出有問題的節點與問題。 */
export function nodeProblemsOf(
  result: CdnCheckResult,
): Array<{ address: string; problems: CdnNodeProblem[] }> {
  return result.nodes
    .filter((node) => node.problems.length > 0)
    .map(({ address, problems }) => ({ address, problems }));
}
