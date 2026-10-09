import { describe, expect, it } from 'vitest';

import type { CdnEdgeStatusResult } from '@/core/storage';

import {
  classifyPublicUrl,
  classifyTamperedUrl,
  evaluateNode,
  isReady,
  nodeProblemsOf,
} from '../cdn-check';

const KIDS = ['k2', 'k1'];

function ok(kids: string[]): CdnEdgeStatusResult {
  return {
    address: '10.0.0.1',
    result: 'ok',
    status: {
      kids,
      cache: { maxSize: '10g', inactive: '30d', valid: '30d' },
      build: 'abc',
      startedAt: '2026-10-09T00:00:00Z',
    },
  };
}

describe('開啟前檢查的判斷（docs/architecture/backend/09-file.md §16.10）', () => {
  it('節點有 api 的整個金鑰環 → 沒有問題', () => {
    const node = evaluateNode(ok(['k2', 'k1']), KIDS);
    expect(node.problems).toEqual([]);
    expect(node).toMatchObject({ kids: ['k2', 'k1'], missingKids: [], build: 'abc' });
    expect(isReady(true, [node])).toBe(true);
  });

  it('缺少簽發中的 kid → signingKidMissing，不能開啟', () => {
    const node = evaluateNode(ok(['k1']), KIDS);
    expect(node.problems).toEqual(['signingKidMissing']);
    expect(node.missingKids).toEqual(['k2']);
    expect(isReady(true, [node])).toBe(false);
  });

  it('只缺可驗證的舊 kid（輪替中）→ 只警告，可以開啟', () => {
    const node = evaluateNode(ok(['k2']), KIDS);
    expect(node.problems).toEqual(['verifyKidMissing']);
    expect(isReady(true, [node])).toBe(true);
  });

  it.each([
    ['rejected', 'purgeSecretRejected'],
    ['invalid', 'badResponse'],
    ['timeout', 'timeout'],
    ['error', 'unreachable'],
  ] as const)('/_status 是 %s → %s，不能開啟', (result, problem) => {
    const node = evaluateNode({ address: '10.0.0.2', result }, KIDS);
    expect(node.problems).toEqual([problem]);
    expect(node.kids).toBeNull();
    expect(isReady(true, [node])).toBe(false);
  });

  it('任一節點有問題 → 整體不通過；沒有節點、找不到節點也不通過', () => {
    const good = evaluateNode(ok(KIDS), KIDS);
    const bad = evaluateNode({ address: '10.0.0.2', result: 'timeout' }, KIDS);
    expect(isReady(true, [good, bad])).toBe(false);
    expect(isReady(true, [])).toBe(false);
    expect(isReady(false, [good])).toBe(false);
  });

  it('409 的 details.nodes 只列出有問題的節點', () => {
    const good = evaluateNode(ok(KIDS), KIDS);
    const bad = evaluateNode({ address: '10.0.0.2', result: 'rejected' }, KIDS);
    expect(
      nodeProblemsOf({
        checkedAt: '',
        ready: false,
        discovery: { ok: true },
        nodes: [good, bad],
        publicUrl: { result: 'ok' },
        signatureEnforced: { result: 'ok' },
      }),
    ).toEqual([{ address: '10.0.0.2', problems: ['purgeSecretRejected'] }]);
  });
});

describe('對外網址的檢查（項目 4、5；§17 D17）', () => {
  it('正確的簽章打不存在的路徑：404 是源站的回應；403 依 X-CDN-Reject 區分邊緣與源站', () => {
    expect(classifyPublicUrl(404, null)).toBe('ok');
    expect(classifyPublicUrl(403, 'signature')).toBe('signatureRejected');
    expect(classifyPublicUrl(403, null)).toBe('originAuthRejected');
    expect(classifyPublicUrl(502, null)).toBe('originUnreachable');
    expect(classifyPublicUrl(504, null)).toBe('originUnreachable');
    expect(classifyPublicUrl(200, null)).toBe('unexpected');
  });

  it('竄改的簽章：要被邊緣以 signature 拒絕；放行到源站就是沒有驗簽章', () => {
    expect(classifyTamperedUrl(403, 'signature')).toBe('ok');
    expect(classifyTamperedUrl(404, null)).toBe('notEnforced');
    expect(classifyTamperedUrl(200, null)).toBe('notEnforced');
    expect(classifyTamperedUrl(403, null)).toBe('unexpected');
  });
});
