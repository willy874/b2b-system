import { RateLimiter } from '../rate-limit';

describe('RateLimiter（每個來源每分鐘）', () => {
  it('上限內放行，超過時回要等的秒數', () => {
    const limiter = new RateLimiter(2);
    expect(limiter.hit('a', 0)).toBeUndefined();
    expect(limiter.hit('a', 1000)).toBeUndefined();
    expect(limiter.hit('a', 30_000)).toBe(30);
  });

  it('不同來源分開計數', () => {
    const limiter = new RateLimiter(1);
    expect(limiter.hit('a', 0)).toBeUndefined();
    expect(limiter.hit('b', 0)).toBeUndefined();
  });

  it('過了一分鐘重新計數', () => {
    const limiter = new RateLimiter(1);
    limiter.hit('a', 0);
    expect(limiter.hit('a', 60_000)).toBeUndefined();
  });
});
