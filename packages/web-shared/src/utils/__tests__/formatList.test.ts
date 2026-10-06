import { describe, expect, it } from 'vitest';

import { formatList } from '../formatList';

describe('formatList（依語系串接清單）', () => {
  it('中文用頓號與「和」，英文用逗號與 and', () => {
    expect(formatList(['VIP', 'Partner', 'Gold'], 'zh-TW')).toBe('VIP、Partner和Gold');
    expect(formatList(['VIP', 'Partner', 'Gold'], 'en-US')).toBe('VIP, Partner, and Gold');
  });

  it('一個或沒有項目', () => {
    expect(formatList(['VIP'], 'en-US')).toBe('VIP');
    expect(formatList([], 'en-US')).toBe('');
  });

  it('不合法的語系標籤不丟例外', () => {
    expect(formatList(['A', 'B'], 'not a locale!')).toContain('A');
  });
});
