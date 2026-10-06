import { describe, expect, it } from 'vitest';

import { IMAGE_FORMAT_CONTENT_TYPE, IMAGE_FORMATS, ImageDecodeError } from '../image-processor';

describe('ImageDecodeError', () => {
  it('是 Error，name 是 ImageDecodeError', () => {
    const error = new ImageDecodeError('壞掉了');
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'ImageDecodeError', message: '壞掉了' });
  });

  it('保留原因（cause）', () => {
    const cause = new Error('libvips');
    expect(new ImageDecodeError('無法解碼影像', { cause }).cause).toBe(cause);
  });
});

describe('IMAGE_FORMAT_CONTENT_TYPE', () => {
  it.each(IMAGE_FORMATS)('%s 對應到 image/ 開頭的 MIME 型別', (format) => {
    expect(IMAGE_FORMAT_CONTENT_TYPE[format]).toBe(`image/${format}`);
  });
});
