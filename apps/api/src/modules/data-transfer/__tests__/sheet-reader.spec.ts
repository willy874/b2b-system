import ExcelJS from 'exceljs';

import { decodeText, detectDelimiter, readCsv, readXlsx } from '../import/sheet-reader';

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
});
