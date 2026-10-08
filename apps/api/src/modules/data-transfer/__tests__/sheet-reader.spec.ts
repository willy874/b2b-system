import ExcelJS from 'exceljs';

import {
  dataCellText,
  decodeText,
  detectDelimiter,
  readCsv,
  readJson,
  readXlsx,
  readYaml,
} from '../import/sheet-reader';

const utf8 = (text: string) => new Uint8Array(Buffer.from(text, 'utf8'));

describe('匯入的讀檔器（docs/architecture/backend/22-data-transfer.md §7.3）', () => {
  describe('編碼', () => {
    it('依 BOM 判斷 UTF-8／UTF-16LE', () => {
      expect(decodeText(utf8('﻿abc'), 'auto')).toEqual({ text: 'abc', encoding: 'utf-8' });
      const utf16 = new Uint8Array([0xff, 0xfe, ...Buffer.from('中', 'utf16le')]);
      expect(decodeText(utf16, 'auto')).toEqual({ text: '中', encoding: 'utf-16le' });
    });

    it('沒有 BOM 又不是合法的 UTF-8 時退回 Big5', () => {
      // 「王小明」的 Big5
      const big5 = new Uint8Array(Buffer.from('a4fda470a9fa', 'hex'));
      expect(decodeText(big5, 'auto')).toEqual({ text: '王小明', encoding: 'big5' });
    });

    it('使用者指定編碼時照它', () => {
      expect(decodeText(utf8('abc'), 'utf-8').encoding).toBe('utf-8');
    });
  });

  it.each([
    ['a,b,c', ','],
    ['a;b;c', ';'],
    ['a\tb\tc', '\t'],
    ['"a,b";c;d', ';'],
  ])('分隔字元：%j → %j', (text, expected) => {
    expect(detectDelimiter(text)).toBe(expected);
  });

  it('CSV：空白列略過、第一個非空白列是標頭、列號是檔案中的實際列號', () => {
    const result = readCsv(
      utf8('\r\nemail,name\r\n\r\na@example.com,"A, Jr."\r\nb@example.com,B\r\n'),
      'auto',
    );
    expect(result).toEqual({
      ok: true,
      header: ['email', 'name'],
      rows: [
        { sourceRow: 4, cells: ['a@example.com', 'A, Jr.'] },
        { sourceRow: 5, cells: ['b@example.com', 'B'] },
      ],
      warnings: [],
      encoding: 'utf-8',
    });
  });

  it('CSV：整份都是空白回 noHeader', () => {
    expect(readCsv(utf8('\r\n , \r\n'), 'auto')).toEqual({ ok: false, reason: 'noHeader' });
  });

  it('XLSX：日期、數字、布林、公式的快取結果轉成字串；沒有結果的公式是空白加警告', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Data');
    workbook.addWorksheet('Other');
    sheet.addRow(['date', 'time', 'number', 'flag', 'formula', 'empty']);
    sheet.addRow([
      new Date(Date.UTC(2026, 9, 8)),
      new Date(Date.UTC(2026, 9, 8, 14, 30)),
      42,
      true,
      { formula: '1+1', result: 2 },
      { formula: 'A1' },
    ]);
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    const result = await readXlsx(bytes);
    expect(result).toMatchObject({
      ok: true,
      header: ['date', 'time', 'number', 'flag', 'formula', 'empty'],
      rows: [{ sourceRow: 2, cells: ['2026-10-08', '2026-10-08T14:30:00', '42', 'true', '2', ''] }],
      sheets: ['Data', 'Other'],
      warnings: [{ sourceRow: 2, column: 5, code: 'formulaWithoutValue' }],
    });
    expect(await readXlsx(bytes, 'Missing')).toEqual({ ok: false, reason: 'sheetNotFound' });
  });

  it('XLSX：不是 zip（例：加密的檔案）回錯誤，不拋例外', async () => {
    const result = await readXlsx(utf8('not a zip'));
    expect(result.ok).toBe(false);
  });

  describe('JSON／YAML', () => {
    it('結構化的值 → 儲存格文字：陣列以 ; 串接、null 是空白、物件是 JSON', () => {
      expect(dataCellText(['a', 'b'])).toBe('a;b');
      expect(dataCellText(null)).toBe('');
      expect(dataCellText(5)).toBe('5');
      expect(dataCellText(true)).toBe('true');
      expect(dataCellText({ a: 1 })).toBe('{"a":1}');
    });

    it('JSON：物件陣列 → 標頭是所有鍵（依出現順序）、列號是第幾筆', () => {
      const result = readJson(
        utf8(
          JSON.stringify([
            { email: 'a@example.com', roles: ['稽核人員', '一般成員'] },
            {},
            { email: 'b@example.com', displayName: 'B', roles: null },
          ]),
        ),
        'auto',
      );
      expect(result).toEqual({
        ok: true,
        header: ['email', 'roles', 'displayName'],
        rows: [
          { sourceRow: 1, cells: ['a@example.com', '稽核人員;一般成員', ''] },
          { sourceRow: 3, cells: ['b@example.com', '', 'B'] },
        ],
        warnings: [],
        encoding: 'utf-8',
      });
    });

    it('JSON：只有一個陣列屬性的物件也可以（例：{ "users": [...] }）', () => {
      const result = readJson(utf8('{"users":[{"email":"a@example.com"}]}'), 'auto');
      expect(result).toMatchObject({ ok: true, header: ['email'] });
    });

    it.each([
      ['不是 JSON', '{'],
      ['不是物件陣列', '[1, 2]'],
      ['有兩個陣列，不知道要讀哪一個', '{"a":[],"b":[]}'],
    ])('JSON：讀不了（%s）', (_name, text) => {
      expect(readJson(utf8(text), 'auto')).toEqual({ ok: false, reason: 'unreadable' });
    });

    it('YAML：日期不會變成 Date（YAML 1.2 core schema），多值是序列', () => {
      const result = readYaml(
        utf8('- email: a@example.com\n  createdAt: 2026-10-08\n  roles:\n    - 稽核人員\n'),
        'auto',
      );
      expect(result).toMatchObject({
        ok: true,
        header: ['email', 'createdAt', 'roles'],
        rows: [{ sourceRow: 1, cells: ['a@example.com', '2026-10-08', '稽核人員'] }],
      });
    });

    it('YAML：別名展開有上限（billion laughs）', () => {
      // 唯一的陣列是 items：讀不了只會是因為別名超過上限
      const bomb = [
        'items:',
        '  - a: &a ["x","x","x","x","x","x","x","x","x"]',
        ...Array.from({ length: 12 }, (_, index) => {
          const name = String.fromCodePoint(98 + index);
          const prev = String.fromCodePoint(97 + index);
          return `    ${name}: &${name} [${Array.from({ length: 9 }, () => `*${prev}`).join(',')}]`;
        }),
      ].join('\n');
      expect(readYaml(utf8(bomb), 'auto')).toEqual({ ok: false, reason: 'unreadable' });
    });
  });
});
