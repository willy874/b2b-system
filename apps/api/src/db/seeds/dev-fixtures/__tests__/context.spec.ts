import { describe, expect, it } from 'vitest';

import { createRandom, fixtureId } from '../context';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('fixtureId', () => {
  it('同一個 key 永遠得到同一個 uuid（重跑 db:seed:dev 才不會重複）', () => {
    expect(fixtureId('announcement:welcome')).toBe(fixtureId('announcement:welcome'));
  });

  it('不同的 key 得到不同的 uuid', () => {
    expect(fixtureId('tag:user:VIP 窗口')).not.toBe(fixtureId('tag:file:VIP 窗口'));
  });

  it('是合法的 RFC 4122 形狀（版本 5、variant 10xx）', () => {
    for (const key of ['a', 'webhook:crm-users', '回收桶']) {
      expect(fixtureId(key)).toMatch(UUID_PATTERN);
    }
  });
});

describe('createRandom', () => {
  it('同一個種子產生同一串亂數', () => {
    const first = createRandom(42);
    const second = createRandom(42);
    const values = Array.from({ length: 5 }, () => first());
    expect(Array.from({ length: 5 }, () => second())).toEqual(values);
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
