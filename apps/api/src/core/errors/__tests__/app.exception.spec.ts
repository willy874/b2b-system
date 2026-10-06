import { describe, expect, it } from 'vitest';

import { AppException } from '../app.exception';

describe('AppException', () => {
  it('沒給訊息時以錯誤碼當訊息', () => {
    expect(new AppException('NOT_FOUND').message).toBe('NOT_FOUND');
  });

  it('帶上錯誤碼、details 與自訂訊息', () => {
    const error = new AppException('CONFLICT', { field: 'email' }, '已存在');
    expect(error).toMatchObject({
      code: 'CONFLICT',
      details: { field: 'email' },
      message: '已存在',
    });
  });

  it('是 Error，name 是 AppException（日誌與堆疊看得出來）', () => {
    const error = new AppException('NOT_FOUND');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppException');
  });
});
