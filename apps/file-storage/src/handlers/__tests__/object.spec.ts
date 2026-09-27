import { parseRange } from '@/handlers/object';
import { S3Error } from '@/s3/errors';

describe('parseRange（GetObject 的 Range 標頭）', () => {
  it.each([
    ['bytes=0-4', { start: 0, end: 4 }],
    ['bytes=5-', { start: 5, end: 9 }],
    ['bytes=-3', { start: 7, end: 9 }],
    ['bytes=-30', { start: 0, end: 9 }],
    ['bytes=8-100', { start: 8, end: 9 }],
  ])('%s → %o（物件 10 位元組）', (header, expected) => {
    expect(parseRange(header, 10)).toEqual(expected);
  });

  it.each([undefined, 'bytes=0-1,3-4', 'items=0-1', 'bytes=-'])(
    '%s 忽略 Range、回整個物件',
    (header) => {
      expect(parseRange(header, 10)).toBeUndefined();
    },
  );

  it.each(['bytes=10-', 'bytes=5-2', 'bytes=-0'])('%s 回 InvalidRange', (header) => {
    expect(() => parseRange(header, 10)).toThrow(S3Error);
  });
});
