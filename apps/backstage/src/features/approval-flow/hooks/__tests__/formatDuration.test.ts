import { describe, expect, it } from 'vitest';

import { formatDuration } from '../formatDuration';

const t = (key: string, options?: Record<string, unknown>) => `${key}:${String(options?.count)}`;

describe('formatDuration（平均定案時間）', () => {
  it.each([
    [0.01, 'approvalFlow.duration.minutes:1'],
    [0.5, 'approvalFlow.duration.minutes:30'],
    [5.25, 'approvalFlow.duration.hours:5.3'],
    [47, 'approvalFlow.duration.hours:47'],
    [72, 'approvalFlow.duration.days:3'],
  ])('%s 小時 → %s', (hours, expected) => {
    expect(formatDuration(hours, t)).toBe(expected);
  });
});
