import { describe, expect, it } from 'vitest';

import { DomainEvent } from '../domain-events';

describe('DomainEvent（事件名稱）', () => {
  const names = Object.values(DomainEvent);

  it('名稱都不重複（重複會讓兩種事件的訂閱者混在一起）', () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(names)('%s 是 <領域>.<動作> 的 camelCase', (name) => {
    expect(name).toMatch(/^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/);
  });
});
