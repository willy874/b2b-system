import { describe, expect, it } from 'vitest';

import { imageSignatureValidator, maxSizeValidator } from '../validators';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];

describe('內建的檔案驗證器', () => {
  it('max-size：超過上限回問題；上傳政策還沒載入（沒有 maxSize）時放行', () => {
    const file = new File(['12345'], 'a.bin');
    expect(maxSizeValidator.validate(file, { maxSize: 4 })).toMatchObject({
      messageKey: 'file.validation.tooLarge',
    });
    expect(maxSizeValidator.validate(file, { maxSize: 5 })).toBeUndefined();
    expect(maxSizeValidator.validate(file, {})).toBeUndefined();
  });

  it('image-signature：檔頭相符的 PNG 通過', async () => {
    const file = new File([new Uint8Array(PNG)], 'a.png', { type: 'image/png' });
    await expect(imageSignatureValidator.validate(file, {})).resolves.toBeUndefined();
  });

  it('image-signature：改了副檔名的文字檔宣稱是 PNG → 擋下', async () => {
    const file = new File(['not an image'], 'fake.png', { type: 'image/png' });
    await expect(imageSignatureValidator.validate(file, {})).resolves.toMatchObject({
      messageKey: 'file.validation.imageCorrupted',
      params: { type: 'image/png' },
    });
  });

  it('image-signature：不認得的型別不檢查', async () => {
    const file = new File(['whatever'], 'a.svg', { type: 'image/svg+xml' });
    await expect(imageSignatureValidator.validate(file, {})).resolves.toBeUndefined();
  });
});
