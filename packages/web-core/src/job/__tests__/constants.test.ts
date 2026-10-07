import { describe, expect, it } from 'vitest';

import { isFinalJobState, JOB_STATE_LABEL_KEY, JOB_STATES } from '../constants';
import type { JobState } from '../constants';

describe('isFinalJobState', () => {
  it('完成、取消、失敗是結束狀態；等待、重試、執行中不是', () => {
    const finals: JobState[] = ['completed', 'cancelled', 'failed'];
    const pendings: JobState[] = ['created', 'retry', 'active'];
    expect(finals.every(isFinalJobState)).toBe(true);
    expect(pendings.some(isFinalJobState)).toBe(false);
  });

  it('每個狀態都有語系鍵', () => {
    expect(Object.keys(JOB_STATE_LABEL_KEY).toSorted()).toEqual([...JOB_STATES].toSorted());
  });
});
