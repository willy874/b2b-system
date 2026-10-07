import { z } from 'zod';

import { AppException } from '@/core/errors';

import type { ImportColumnSets } from '../data-transfer.columns';
import type { TransferColumn } from '../data-transfer.types';
import { mapHeaders, parseMappingParam, toCells } from '../import/header-mapping';

function column(key: string, label: string, extra: Partial<TransferColumn<unknown>> = {}) {
  return {
    key,
    label: { 'zh-TW': label, 'en-US': key },
    kind: 'string',
    export: { get: () => '' },
    import: { modes: ['create', 'update'], schema: z.string() },
    ...extra,
  } as TransferColumn<unknown>;
}

const ID = column('id', 'ID', { import: { modes: ['update'], matchKey: 1, schema: z.string() } });
const EMAIL = column('email', '電子郵件', {
  aliases: ['mail'],
  import: { modes: ['create', 'update'], requiredOnCreate: true, matchKey: 2, schema: z.string() },
});
const NAME = column('displayName', '顯示名稱', {
  import: { modes: ['create', 'update'], requiredOnCreate: true, schema: z.string() },
});
const ROLES = column('roles', '角色', { multiple: {}, kind: 'reference' });
const CREATED = column('createdAt', '建立時間', { import: undefined });

const sets = (
  importable: TransferColumn<unknown>[],
  extra: Partial<ImportColumnSets> = {},
): ImportColumnSets => ({
  importable,
  forbidden: [],
  readOnly: [CREATED],
  ...extra,
});

describe('標頭對應（docs/architecture/backend/22-data-transfer.md §7.3、D5）', () => {
  it('以 key、任一語系的 label、別名比對，正規化後與介面語言無關', () => {
    const result = mapHeaders(
      ['MAIL', 'displayName', '建立時間'],
      sets([EMAIL, NAME, ROLES]),
      'create',
      null,
    );
    expect(result).toMatchObject({
      complete: true,
      mapping: ['email', 'displayName', null],
      ignored: [{ header: '建立時間', reason: 'readOnly' }],
    });
  });

  it('不認得的標頭不默默忽略：要使用者對應', () => {
    const result = mapHeaders(
      ['email', 'displayName', '部門'],
      sets([EMAIL, NAME]),
      'create',
      null,
    );
    expect(result).toMatchObject({ complete: false });
  });

  it('新增模式缺必填欄、修改模式沒有比對鍵或可修改的欄位時都不完整', () => {
    expect(mapHeaders(['email'], sets([EMAIL, NAME]), 'create', null).complete).toBe(false);
    expect(mapHeaders(['displayName'], sets([ID, EMAIL, NAME]), 'update', null).complete).toBe(
      false,
    );
    expect(mapHeaders(['email'], sets([ID, EMAIL, NAME]), 'update', null).complete).toBe(false);
    expect(
      mapHeaders(['id', 'displayName'], sets([ID, EMAIL, NAME]), 'update', null).complete,
    ).toBe(true);
  });

  it('沒有權限的欄位標為忽略並註明原因', () => {
    const result = mapHeaders(
      ['email', 'displayName', '角色'],
      sets([EMAIL, NAME], { forbidden: [ROLES] }),
      'create',
      null,
    );
    expect(result).toMatchObject({
      complete: true,
      ignored: [{ header: '角色', reason: 'forbidden' }],
    });
  });

  it('多值欄位可以出現在多欄，每欄一個值', () => {
    const result = mapHeaders(
      ['email', 'displayName', 'roles', 'roles'],
      sets([EMAIL, NAME, ROLES]),
      'create',
      null,
    );
    expect(result.complete).toBe(true);
    if (!result.complete) return;
    expect(
      toCells(['a@example.com', 'A', '編輯者', '檢視者'], result.mapping, result.columns),
    ).toEqual({
      email: 'a@example.com',
      displayName: 'A',
      roles: '編輯者;檢視者',
    });
  });

  it('mapping 參數：不存在的欄位、同一欄對兩次、序號越界都是 DATA_TRANSFER_MAPPING_INVALID', () => {
    const importable = [EMAIL, NAME, ROLES];
    expect(parseMappingParam('{"0":"email","1":null}', 2, importable)).toEqual(['email', null]);
    for (const raw of ['{"0":"nope"}', '{"0":"email","1":"email"}', '{"5":"email"}', 'not json']) {
      expect(() => parseMappingParam(raw, 2, importable)).toThrow(AppException);
    }
    expect(parseMappingParam('{"0":"roles","1":"roles"}', 2, importable)).toEqual([
      'roles',
      'roles',
    ]);
  });
});
