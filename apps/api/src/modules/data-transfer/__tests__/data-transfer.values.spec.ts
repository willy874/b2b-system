import { z } from 'zod';

import type { TransferColumn } from '../data-transfer.types';
import {
  cleanText,
  closest,
  editDistance,
  escapeFormula,
  fileTimestamp,
  formatZonedDateTime,
  normalizeText,
  parseCell,
  snakeCase,
  sqlType,
  toCellText,
  toDataValue,
  toSqlLiteral,
  toXlsxValue,
  wallClock,
  zonedWallTimeToInstant,
} from '../data-transfer.values';

const ctx = { locale: 'zh-TW', timezone: 'Asia/Taipei' } as const;

function column(overrides: Partial<TransferColumn<unknown>>): TransferColumn<unknown> {
  return {
    key: 'value',
    label: { 'zh-TW': '值', 'en-US': 'Value' },
    kind: 'string',
    import: { modes: ['create', 'update'], schema: z.string() },
    ...overrides,
  };
}

const STATUS = column({
  kind: 'enum',
  enum: [
    { value: 'active', label: { 'zh-TW': '啟用', 'en-US': 'Active' }, aliases: ['enabled'] },
    { value: 'inactive', label: { 'zh-TW': '停用', 'en-US': 'Inactive' } },
  ],
});

describe('值的格式（docs/architecture/backend/22-data-transfer.md §5.3）', () => {
  describe('匯出的文字表示', () => {
    it.each([
      ['boolean', true, '是'],
      ['boolean', false, '否'],
      ['date', '2026-10-08', '2026-10-08'],
      ['datetime', new Date('2026-10-08T06:30:00Z'), '2026-10-08T14:30:00+08:00'],
      ['json', { a: 1 }, '{"a":1}'],
      ['number', -5, '-5'],
    ] as const)('%s：%j → %s', (kind, value, expected) => {
      expect(toCellText(column({ kind }), value, ctx)).toBe(expected);
    });

    it('enum 輸出匯出者語系的標籤；多值以 ; 串接；null 是空白', () => {
      expect(toCellText(STATUS, 'active', ctx)).toBe('啟用');
      expect(toCellText(STATUS, 'active', { ...ctx, locale: 'en-US' })).toBe('Active');
      expect(toCellText(column({ multiple: {} }), ['a', 'b'], ctx)).toBe('a;b');
      expect(toCellText(column({}), null, ctx)).toBe('');
    });
  });

  it("公式注入：文字開頭是 = + - @ Tab CR 時前置 '；數字與日期不加", () => {
    expect(escapeFormula(column({}), '=SUM(A1)')).toBe("'=SUM(A1)");
    expect(escapeFormula(column({}), '@me')).toBe("'@me");
    expect(escapeFormula(column({}), 'plain')).toBe('plain');
    expect(escapeFormula(column({ kind: 'number' }), '-5')).toBe('-5');
  });

  it('SQL：字串的單引號加倍、enum 輸出值代碼、多值是陣列、datetime 是 UTC', () => {
    expect(toSqlLiteral(column({}), "O'Brien")).toBe("'O''Brien'");
    expect(toSqlLiteral(STATUS, 'active')).toBe("'active'");
    expect(toSqlLiteral(column({ multiple: {} }), ['a', 'b'])).toBe("ARRAY['a', 'b']");
    expect(toSqlLiteral(column({ multiple: {} }), [])).toBe("'{}'::text[]");
    expect(toSqlLiteral(column({ kind: 'datetime' }), new Date('2026-01-02T03:04:05Z'))).toBe(
      "'2026-01-02T03:04:05.000Z'",
    );
    expect(toSqlLiteral(column({ kind: 'boolean' }), null)).toBe('NULL');
  });

  it('時區：牆上時間加時差、檔名用的時間戳', () => {
    const instant = new Date('2026-10-08T06:30:59Z');
    expect(formatZonedDateTime(instant, 'America/New_York')).toBe('2026-10-08T02:30:59-04:00');
    expect(fileTimestamp(instant, 'Asia/Taipei')).toBe('20261008-1430');
    expect(snakeCase('displayName')).toBe('display_name');
  });

  describe('匯入的解析', () => {
    it.each([
      ['   ', { kind: 'empty' }],
      ['\\N', { kind: 'null' }],
      ["'=SUM(A1)", { kind: 'value', value: '=SUM(A1)' }],
      ["'plain", { kind: 'value', value: "'plain" }],
    ] as const)('字串 %j', (raw, expected) => {
      expect(parseCell(column({}), raw, ctx)).toEqual(expected);
    });

    it('數字拒絕 1e3、0x10', () => {
      expect(parseCell(column({ kind: 'number' }), '12.5', ctx)).toEqual({
        kind: 'value',
        value: 12.5,
      });
      expect(parseCell(column({ kind: 'number' }), '1e3', ctx)).toMatchObject({
        code: 'invalidNumber',
      });
      expect(parseCell(column({ kind: 'number' }), '0x10', ctx)).toMatchObject({
        code: 'invalidNumber',
      });
    });

    it.each(['true', 'Y', '是', 'yes', 'Yes', '1'])('布林 %s 是 true', (raw) => {
      expect(parseCell(column({ kind: 'boolean' }), raw, ctx)).toEqual({
        kind: 'value',
        value: true,
      });
    });

    it('日期接受 YYYY/MM/DD，拒絕不存在的日期', () => {
      expect(parseCell(column({ kind: 'date' }), '2026/1/2', ctx)).toEqual({
        kind: 'value',
        value: '2026-01-02',
      });
      expect(parseCell(column({ kind: 'date' }), '2026-02-30', ctx)).toMatchObject({
        code: 'invalidDate',
      });
    });

    it('日期時間沒有時差時以建立者的時區解讀', () => {
      expect(parseCell(column({ kind: 'datetime' }), '2026-10-08 14:30', ctx)).toEqual({
        kind: 'value',
        value: new Date('2026-10-08T06:30:00Z'),
      });
      expect(parseCell(column({ kind: 'datetime' }), '2026-10-08T14:30:00Z', ctx)).toEqual({
        kind: 'value',
        value: new Date('2026-10-08T14:30:00Z'),
      });
    });

    it('enum 接受值代碼、任一語系的標籤與別名，完全相符；對不上時附上最接近的候選（不自動更正）', () => {
      for (const raw of ['active', '啟用', 'ACTIVE', 'Enabled', ' Active ']) {
        expect(parseCell(STATUS, raw, ctx)).toEqual({ kind: 'value', value: 'active' });
      }
      expect(parseCell(STATUS, '啟', ctx)).toMatchObject({
        kind: 'issue',
        code: 'invalidEnum',
        params: { value: '啟', suggestion: '啟用' },
      });
    });

    it('多值以 ; 分隔、去重；超過上限是 tooManyValues', () => {
      const roles = column({ kind: 'reference', multiple: { max: 2 } });
      expect(parseCell(roles, 'a; b ;a', ctx)).toEqual({ kind: 'value', value: ['a', 'b'] });
      expect(parseCell(roles, 'a;b;c', ctx)).toMatchObject({
        code: 'tooManyValues',
        params: { max: 2 },
      });
    });
  });

  it('最接近的候選：差太多就不建議', () => {
    expect(closest('財務管理', ['財務管理員', '系統管理員'])).toBe('財務管理員');
    expect(closest('xyz', ['財務管理員'])).toBeNull();
  });

  describe('匯出的文字表示：日期與無效值', () => {
    it.each([
      ['date：Date 以匯出者時區取日期', 'date', new Date('2026-10-08T20:00:00Z'), '2026-10-09'],
      ['date：時間戳（數字）', 'date', Date.UTC(2026, 0, 2, 3), '2026-01-02'],
      ['date：ISO 字串', 'date', '2026-01-02T03:00:00Z', '2026-01-02'],
      ['date：無效的 Date 是空白', 'date', new Date('nope'), ''],
      ['date：無法解析的字串是空白', 'date', 'nope', ''],
      ['date：其他型別是空白', 'date', { a: 1 }, ''],
      ['datetime：無效值是空白', 'datetime', 'nope', ''],
      ['string：undefined 是空白', 'string', undefined, ''],
      ['reference：照原樣', 'reference', '管理員', '管理員'],
    ] as const)('%s', (_name, kind, value, expected) => {
      expect(toCellText(column({ kind }), value, ctx)).toBe(expected);
    });

    it('enum 找不到選項時輸出原值；沒有選項定義時也是原值', () => {
      expect(toCellText(STATUS, 'archived', ctx)).toBe('archived');
      expect(toCellText(column({ kind: 'enum' }), 'x', ctx)).toBe('x');
    });

    it('日期時間的時差為負、非整點時以 ±HH:MM 表示', () => {
      const instant = new Date('2026-10-08T06:30:00Z');
      expect(formatZonedDateTime(instant, 'Asia/Kolkata')).toBe('2026-10-08T12:00:00+05:30');
      expect(formatZonedDateTime(instant, 'UTC')).toBe('2026-10-08T06:30:00+00:00');
    });
  });

  it('escapeFormula：日期與日期時間不加前綴', () => {
    expect(escapeFormula(column({ kind: 'date' }), '-')).toBe('-');
    expect(escapeFormula(column({ kind: 'datetime' }), '+1')).toBe('+1');
    expect(escapeFormula(STATUS, '-x')).toBe("'-x");
  });

  describe('XLSX 的值（§6.5）', () => {
    it.each([
      ['空值是 null', column({}), null, null],
      ['undefined 是 null', column({}), undefined, null],
      ['多值是文字', column({ multiple: {} }), ['a', 'b'], 'a;b'],
      ['數字是數字', column({ kind: 'number' }), 3.5, 3.5],
      ['數字欄的非數字是文字', column({ kind: 'number' }), '3x', '3x'],
      ['日期是 UTC 午夜', column({ kind: 'date' }), '2026-10-08', new Date('2026-10-08T00:00:00Z')],
      ['無效的日期是 null', column({ kind: 'date' }), 'nope', null],
      [
        '日期時間是匯出者時區的牆上時間',
        column({ kind: 'datetime' }),
        new Date('2026-10-08T06:30:00Z'),
        new Date('2026-10-08T14:30:00Z'),
      ],
      ['無效的日期時間是 null', column({ kind: 'datetime' }), 'nope', null],
      ['布林是標籤', column({ kind: 'boolean' }), false, '否'],
      ['enum 是標籤', STATUS, 'inactive', '停用'],
    ] as const)('%s', (_name, col, value, expected) => {
      expect(toXlsxValue(col, value, ctx)).toEqual(expected);
    });
  });

  describe('JSON／YAML 的值（§6.5）', () => {
    it.each([
      ['數字保留型別', column({ kind: 'number' }), 3, 3],
      ['非有限數字轉文字', column({ kind: 'number' }), Number.NaN, 'NaN'],
      ['數字欄的文字照原樣', column({ kind: 'number' }), '12', '12'],
      ['布林保留型別', column({ kind: 'boolean' }), 1, true],
      ['日期是文字', column({ kind: 'date' }), '2026-10-08', '2026-10-08'],
      ['無效的日期是 null', column({ kind: 'date' }), 'nope', null],
      [
        '日期時間帶時差',
        column({ kind: 'datetime' }),
        new Date('2026-10-08T06:30:00Z'),
        '2026-10-08T14:30:00+08:00',
      ],
      ['json 照原樣', column({ kind: 'json' }), { a: [1] }, { a: [1] }],
      ['enum 是值代碼', STATUS, 'active', 'active'],
      ['字串', column({}), 5, '5'],
      ['空值是 null', column({}), null, null],
      ['多值的空值是空陣列', column({ multiple: {} }), null, []],
      ['多值的單一值包成陣列', column({ multiple: {} }), 'a', ['a']],
      ['多值逐一轉換', column({ kind: 'number', multiple: {} }), [1, '2'], [1, '2']],
    ] as const)('%s', (_name, col, value, expected) => {
      expect(toDataValue(col, value, ctx)).toEqual(expected);
    });
  });

  describe('SQL（§6.5）', () => {
    it.each([
      ['string', undefined, 'text'],
      ['number', undefined, 'numeric'],
      ['boolean', undefined, 'boolean'],
      ['date', undefined, 'date'],
      ['datetime', undefined, 'timestamptz'],
      ['enum', undefined, 'text'],
      ['reference', { max: 3 }, 'text[]'],
      ['json', undefined, 'jsonb'],
    ] as const)('欄位型別：%s（multiple %j）→ %s', (kind, multiple, expected) => {
      expect(sqlType(column({ kind, multiple }))).toBe(expected);
    });

    it.each([
      ['數字', column({ kind: 'number' }), 12.5, '12.5'],
      ['非有限的數字是 NULL', column({ kind: 'number' }), Number.POSITIVE_INFINITY, 'NULL'],
      ['數字欄的文字是 NULL', column({ kind: 'number' }), '12', 'NULL'],
      ['布林 TRUE', column({ kind: 'boolean' }), 1, 'TRUE'],
      ['布林 FALSE', column({ kind: 'boolean' }), 0, 'FALSE'],
      ['日期字串', column({ kind: 'date' }), '2026-10-08', "'2026-10-08'"],
      [
        '日期的 Date 取 UTC 日期',
        column({ kind: 'date' }),
        new Date('2026-10-08T23:00:00Z'),
        "'2026-10-08'",
      ],
      ['無效的日期是 NULL', column({ kind: 'date' }), 'nope', 'NULL'],
      ['無效的日期時間是 NULL', column({ kind: 'datetime' }), 'nope', 'NULL'],
      ['json', column({ kind: 'json' }), { a: "it's" }, `'{"a":"it''s"}'`],
      ['undefined 是 NULL', column({}), undefined, 'NULL'],
      ['多值的空值是 NULL', column({ multiple: {} }), null, 'NULL'],
      ['多值的單一值包成陣列', column({ multiple: {} }), 'a', "ARRAY['a']"],
    ] as const)('%s', (_name, col, value, expected) => {
      expect(toSqlLiteral(col, value)).toBe(expected);
    });
  });

  describe('時區換算', () => {
    it('wallClock：以 UTC 欄位表示牆上時間', () => {
      expect(wallClock(new Date('2026-10-08T06:30:00Z'), 'Asia/Taipei')).toEqual(
        new Date('2026-10-08T14:30:00Z'),
      );
    });

    it('zonedWallTimeToInstant：牆上時間 → 時刻，跨日光節約也正確', () => {
      expect(zonedWallTimeToInstant([2026, 10, 8, 14, 30, 0], 'Asia/Taipei')).toEqual(
        new Date('2026-10-08T06:30:00Z'),
      );
      // 紐約 2026-03-08 02:00 開始日光節約；之後是 -04:00
      expect(zonedWallTimeToInstant([2026, 3, 8, 12, 0, 0], 'America/New_York')).toEqual(
        new Date('2026-03-08T16:00:00Z'),
      );
      expect(zonedWallTimeToInstant([2026, 1, 8, 12, 0, 0], 'America/New_York')).toEqual(
        new Date('2026-01-08T17:00:00Z'),
      );
    });
  });

  describe('文字工具', () => {
    it.each([
      ['  Display   Name ', 'display name'],
      ['ＡＢＣ', 'abc'],
    ])('normalizeText %j → %j', (raw, expected) => {
      expect(normalizeText(raw)).toBe(expected);
    });

    it.each([
      ["  '+1 ", '+1'],
      ["'abc", "'abc"],
      ['plain', 'plain'],
    ])('cleanText %j → %j', (raw, expected) => {
      expect(cleanText(raw)).toBe(expected);
    });

    it.each([
      ['', '', 0],
      ['abc', '', 3],
      ['', 'ab', 2],
      ['kitten', 'sitting', 3],
      ['same', 'same', 0],
    ])('editDistance(%j, %j) = %d', (a, b, expected) => {
      expect(editDistance(a, b)).toBe(expected);
    });

    it('closest：沒有候選時是 null；長字串的容許距離是長度的三分之一', () => {
      expect(closest('abc', [])).toBeNull();
      expect(closest('abcdefghijkl', ['abcdefghixyz', 'zzz'])).toBe('abcdefghixyz');
      expect(closest('abcdefghijkl', ['abcdefxyzxyz'])).toBeNull();
    });
  });

  describe('匯入的解析：其他型別與錯誤', () => {
    it.each(['false', 'N', '否', 'No', '0'])('布林 %s 是 false', (raw) => {
      expect(parseCell(column({ kind: 'boolean' }), raw, ctx)).toEqual({
        kind: 'value',
        value: false,
      });
    });

    it('布林不認得的字是 invalidBoolean', () => {
      expect(parseCell(column({ kind: 'boolean' }), 'maybe', ctx)).toEqual({
        kind: 'issue',
        code: 'invalidBoolean',
      });
    });

    it.each([
      ['不是日期格式', '10/08/2026'],
      ['不存在的月份', '2026-13-01'],
    ])('日期%s是 invalidDate', (_name, raw) => {
      expect(parseCell(column({ kind: 'date' }), raw, ctx)).toEqual({
        kind: 'issue',
        code: 'invalidDate',
      });
    });

    it.each([
      ['格式不符', '2026-10-08'],
      ['不存在的日期', '2026-02-30 10:00'],
      ['小時超過 23', '2026-10-08 24:00'],
      ['分鐘超過 59', '2026-10-08 10:60'],
      ['秒超過 59', '2026-10-08 10:00:60'],
    ])('日期時間%s是 invalidDateTime', (_name, raw) => {
      expect(parseCell(column({ kind: 'datetime' }), raw, ctx)).toEqual({
        kind: 'issue',
        code: 'invalidDateTime',
      });
    });

    it.each([
      ['帶時差', '2026-10-08T14:30:00+08:00', '2026-10-08T06:30:00Z'],
      ['帶秒與毫秒、空白分隔', '2026-10-08 14:30:15.250Z', '2026-10-08T14:30:15.250Z'],
    ])('日期時間%s時照它的時差', (_name, raw, expected) => {
      expect(parseCell(column({ kind: 'datetime' }), raw, ctx)).toEqual({
        kind: 'value',
        value: new Date(expected),
      });
    });

    it('時差格式合法但無法換算時是 invalidDateTime', () => {
      expect(parseCell(column({ kind: 'datetime' }), '2026-10-08T14:30+99:99', ctx)).toEqual({
        kind: 'issue',
        code: 'invalidDateTime',
      });
    });

    it('enum 差太多時不附建議；沒有選項定義時列出空的選項', () => {
      expect(parseCell(STATUS, '完全不同的值', ctx)).toEqual({
        kind: 'issue',
        code: 'invalidEnum',
        params: { value: '完全不同的值', options: ['啟用', '停用'] },
      });
      expect(parseCell(column({ kind: 'enum' }), 'x', ctx)).toEqual({
        kind: 'issue',
        code: 'invalidEnum',
        params: { value: 'x', options: [] },
      });
    });

    it('多值：任一項有問題就回傳那個問題；空的項目略過；沒有上限時不檢查數量', () => {
      const numbers = column({ kind: 'number', multiple: {} });
      expect(parseCell(numbers, '1;x;2', ctx)).toEqual({ kind: 'issue', code: 'invalidNumber' });
      expect(parseCell(numbers, '1;;2; ', ctx)).toEqual({ kind: 'value', value: [1, 2] });
      expect(parseCell(numbers, ';', ctx)).toEqual({ kind: 'value', value: [] });
    });
  });
});
