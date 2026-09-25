import { describe, expect, it, vi } from 'vitest';

import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import { getRequestContext, runWithRequestContext } from '@/core/http';

import { BatchIdsSchema, runBatch } from '../batch';
import type { BatchSteps } from '../batch';

const TX = { tx: true };
const db = {
  transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(TX),
} as unknown as Database;

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** 每個 id 的 plan 就是 id 本身；`reject` 裡的 id 在 prepare 拋出指定的例外。 */
function stepsFor(reject: Record<string, Error> = {}, skip: string[] = []) {
  const calls: string[] = [];
  const steps: BatchSteps<string> = {
    prepare: vi.fn(async (id: string) => {
      calls.push(`prepare:${id}`);
      const error = reject[id];
      if (error) throw error;
      return skip.includes(id) ? null : id;
    }),
    apply: vi.fn(async (plan: string) => {
      calls.push(`apply:${plan}`);
    }),
    invalidate: vi.fn((plan: string) => {
      calls.push(`invalidate:${plan}`);
    }),
    publish: vi.fn((plans: string[]) => {
      calls.push(`publish:${plans.join(',')}`);
    }),
  };
  return { steps, calls };
}

describe('runBatch（ADR-0009）', () => {
  it('依 ids 順序逐筆「檢查 → 交易 → 失效」，最後發佈一次事件', async () => {
    const { steps, calls } = stepsFor();
    const result = await runBatch(db, ['a', 'b'], steps);

    expect(result).toEqual({ succeeded: ['a', 'b'], failed: [] });
    expect(calls).toEqual([
      'prepare:a',
      'apply:a',
      'invalidate:a',
      'prepare:b',
      'apply:b',
      'invalidate:b',
      'publish:a,b',
    ]);
  });

  it('apply 在交易內執行', async () => {
    const { steps } = stepsFor();
    await runBatch(db, ['a'], steps);
    expect(steps.apply).toHaveBeenCalledWith('a', TX);
  });

  it('AppException 記進 failed（含 details），其餘照常處理', async () => {
    const { steps } = stepsFor({
      b: new AppException('ROLE_IN_USE', { userCount: 3 }),
      c: new AppException('AUTHZ_SELF_MODIFY'),
    });
    const result = await runBatch(db, ['a', 'b', 'c', 'd'], steps);

    expect(result).toEqual({
      succeeded: ['a', 'd'],
      failed: [
        { id: 'b', code: 'ROLE_IN_USE', details: { userCount: 3 } },
        { id: 'c', code: 'AUTHZ_SELF_MODIFY' },
      ],
    });
    expect(steps.publish).toHaveBeenCalledWith(['a', 'd']);
  });

  it('交易內拋出的 AppException 同樣記進 failed，且不失效快取', async () => {
    const { steps } = stepsFor();
    steps.apply = vi.fn(async () => {
      throw new AppException('USER_NOT_FOUND');
    });
    const result = await runBatch(db, ['a'], steps);

    expect(result.failed).toEqual([{ id: 'a', code: 'USER_NOT_FOUND' }]);
    expect(steps.invalidate).not.toHaveBeenCalled();
    expect(steps.publish).not.toHaveBeenCalled();
  });

  it('prepare 回 null（已是結果狀態）→ 算成功，但不寫入、不失效、不發事件', async () => {
    const { steps } = stepsFor({}, ['a']);
    const result = await runBatch(db, ['a'], steps);

    expect(result).toEqual({ succeeded: ['a'], failed: [] });
    expect(steps.apply).not.toHaveBeenCalled();
    expect(steps.invalidate).not.toHaveBeenCalled();
    expect(steps.publish).not.toHaveBeenCalled();
  });

  it('非預期例外往外拋，但仍為已提交的幾筆發佈事件', async () => {
    const { steps } = stepsFor({ b: new Error('connection lost') });
    await expect(runBatch(db, ['a', 'b', 'c'], steps)).rejects.toThrow('connection lost');

    expect(steps.publish).toHaveBeenCalledWith(['a']);
    expect(steps.prepare).not.toHaveBeenCalledWith('c');
  });

  it('執行期間請求 context 帶著 batch 標記，結束後還原', async () => {
    const seen: unknown[] = [];
    const { steps } = stepsFor();
    steps.apply = vi.fn(async () => {
      seen.push(getRequestContext()?.batch);
    });

    await runWithRequestContext({ requestId: 'req-1' }, async () => {
      await runBatch(db, ['a', 'b'], steps);
      expect(getRequestContext()?.batch).toBeUndefined();
      expect(getRequestContext()?.requestId).toBe('req-1');
    });
    expect(seen).toEqual([{ size: 2 }, { size: 2 }]);
  });
});

describe('BatchIdsSchema', () => {
  it('接受 1–200 個不重複的 uuid', () => {
    const ids = Array.from({ length: 200 }, (_, i) => uuid(i));
    expect(BatchIdsSchema.safeParse({ ids }).success).toBe(true);
  });

  it.each([
    ['空陣列', []],
    ['超過 200 筆', Array.from({ length: 201 }, (_, i) => uuid(i))],
    ['重複的 id', [uuid(1), uuid(1)]],
    ['不是 uuid', ['not-a-uuid']],
  ])('拒絕%s', (_, ids) => {
    expect(BatchIdsSchema.safeParse({ ids }).success).toBe(false);
  });
});
