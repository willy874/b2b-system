import { z } from 'zod';

import type { TransferColumn } from '../data-transfer.types';
import {
  closest,
  escapeFormula,
  fileTimestamp,
  formatZonedDateTime,
  parseCell,
  snakeCase,
  toCellText,
  toSqlLiteral,
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
});
