import ExcelJS from 'exceljs';

import {
  dataCellText,
  decodeText,
  detectDelimiter,
  readCsv,
  readJson,
  readRecords,
  readSheet,
  readXlsx,
  readYaml,
} from '../import/sheet-reader';
import type { ParseRequest, ParseResponse } from '../import/sheet-reader';

const utf8 = (text: string) => new Uint8Array(Buffer.from(text, 'utf8'));

/** 以 worker thread 的身分重新載入讀檔器，回傳假的 parentPort。 */
async function loadAsWorker() {
  const { EventEmitter } = await import('node:events');
  const port = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  vi.resetModules();
  vi.doMock('node:worker_threads', () => ({ isMainThread: false, parentPort: port }));
  await import('../import/sheet-reader');
  return port;
}

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

    it('UTF-16BE 的 BOM', () => {
      const utf16be = new Uint8Array([0xfe, 0xff, 0x4e, 0x2d]);
      expect(decodeText(utf16be, 'auto')).toEqual({ text: '中', encoding: 'utf-16be' });
    });

    it('指定 Big5 時不先試 UTF-8', () => {
      const big5 = new Uint8Array(Buffer.from('a4fda470a9fa', 'hex'));
      expect(decodeText(big5, 'big5')).toEqual({ text: '王小明', encoding: 'big5' });
    });

    it('指定 UTF-16 而沒有 BOM 時以 little-endian 解碼', () => {
      expect(decodeText(new Uint8Array(Buffer.from('ab', 'utf16le')), 'utf-16')).toEqual({
        text: 'ab',
        encoding: 'utf-16le',
      });
    });

    it('指定 UTF-8 時不合法的位元組以替代字元呈現，不退回 Big5', () => {
      const big5 = new Uint8Array(Buffer.from('a4fd', 'hex'));
      expect(decodeText(big5, 'utf-8')).toEqual({ text: '\uFFFD\uFFFD', encoding: 'utf-8' });
    });
  });

  it.each([
    ['a,b,c', ','],
    ['a;b;c', ';'],
    ['a\tb\tc', '\t'],
    ['"a,b";c;d', ';'],
    ['\n\n  \nx;y', ';'],
    ['', ','],
    ['abc', ','],
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

  it('CSV：引號沒有收尾讀不了', () => {
    expect(readCsv(utf8('email,name\n"a@example.com,A'), 'auto')).toEqual({
      ok: false,
      reason: 'unreadable',
    });
  });

  it('CSV：Big5 檔案記錄偵測到的編碼', () => {
    const big5 = Buffer.concat([Buffer.from('name\n'), Buffer.from('a4fda470a9fa', 'hex')]);
    expect(readCsv(new Uint8Array(big5), 'auto')).toMatchObject({
      ok: true,
      header: ['name'],
      rows: [{ sourceRow: 2, cells: ['王小明'] }],
      encoding: 'big5',
    });
  });

  it('XLSX：不是 zip（例：加密的檔案）回 encrypted，不拋例外', async () => {
    expect(await readXlsx(utf8('not a zip'))).toEqual({ ok: false, reason: 'encrypted' });
  });

  describe('XLSX：zip 能開但內容讀不了', () => {
    const xlsxProto = Object.getPrototypeOf(new ExcelJS.Workbook().xlsx) as {
      load: (...args: unknown[]) => Promise<unknown>;
    };

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it.each([
      ['錯誤訊息與 zip 無關', new Error('Unexpected close tag')],
      ['拋出的不是 Error', 'boom'],
    ])('回 unreadable（%s）', async (_name, error) => {
      vi.spyOn(xlsxProto, 'load').mockRejectedValue(error);
      expect(await readXlsx(utf8('whatever'))).toEqual({ ok: false, reason: 'unreadable' });
    });
  });

  it('XLSX：沒有工作表、或工作表全空白時回 noHeader', async () => {
    const empty = new ExcelJS.Workbook();
    expect(await readXlsx(new Uint8Array(await empty.xlsx.writeBuffer()))).toEqual({
      ok: false,
      reason: 'noHeader',
    });
    const blank = new ExcelJS.Workbook();
    blank.addWorksheet('Data');
    expect(await readXlsx(new Uint8Array(await blank.xlsx.writeBuffer()))).toEqual({
      ok: false,
      reason: 'noHeader',
    });
  });

  it('XLSX：富文本、超連結、錯誤值、公式的錯誤與日期結果、中間空白的儲存格都轉成字串；指定工作表時讀那一張', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('First').addRow(['ignored']);
    const sheet = workbook.addWorksheet('Data');
    sheet.addRow([
      'rich',
      'link',
      'error',
      'formulaError',
      'formulaDate',
      'formulaText',
      'gap',
      'end',
    ]);
    sheet.addRow([
      { richText: [{ text: '王' }, { text: '小明' }] },
      { text: '網站', hyperlink: 'https://example.com' },
      { error: '#N/A' },
      { formula: '1/0', result: { error: '#DIV/0!' } },
      { formula: 'TODAY()', result: new Date(Date.UTC(2026, 9, 8)) },
      { formula: '"a"&"b"', result: 'ab' },
      null,
      'x',
    ]);
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    const result = await readXlsx(bytes, 'Data');
    expect(result).toMatchObject({
      ok: true,
      header: ['rich', 'link', 'error', 'formulaError', 'formulaDate', 'formulaText', 'gap', 'end'],
      rows: [
        {
          sourceRow: 2,
          cells: ['王小明', '網站', '#N/A', '#DIV/0!', '2026-10-08', 'ab', '', 'x'],
        },
      ],
      sheets: ['First', 'Data'],
      warnings: [],
    });
  });

  describe('JSON／YAML', () => {
    it('結構化的值 → 儲存格文字：陣列以 ; 串接、null 是空白、物件是 JSON', () => {
      expect(dataCellText(['a', 'b'])).toBe('a;b');
      expect(dataCellText(null)).toBe('');
      expect(dataCellText(5)).toBe('5');
      expect(dataCellText(true)).toBe('true');
      expect(dataCellText({ a: 1 })).toBe('{"a":1}');
    });

    it.each([
      ['undefined 是空白', undefined, ''],
      ['bigint', 12n, '12'],
      ['只有日期的 Date', new Date(Date.UTC(2026, 9, 8)), '2026-10-08'],
      ['有時間的 Date', new Date(Date.UTC(2026, 9, 8, 1, 2, 3)), '2026-10-08T01:02:03'],
      ['陣列裡的物件是 JSON、空值略過', [{ a: 1 }, null, '', 'b'], '{"a":1};b'],
    ])('結構化的值 → 儲存格文字：%s', (_name, value, expected) => {
      expect(dataCellText(value)).toBe(expected);
    });

    it.each([
      ['最上層是純量', 5],
      ['最上層是 null', null],
      ['沒有陣列屬性的物件', { users: 'a' }],
    ])('物件陣列 → 讀不了（%s）', (_name, data) => {
      expect(readRecords(data)).toEqual({ ok: false, reason: 'unreadable' });
    });

    it('物件陣列：所有物件都沒有鍵時回 noHeader；標頭去頭尾空白', () => {
      expect(readRecords([{}, {}])).toEqual({ ok: false, reason: 'noHeader' });
      expect(readRecords([{ ' email ': 'a' }])).toMatchObject({ ok: true, header: ['email'] });
    });

    it('JSON／YAML：沒有標頭的結果原樣回傳（不帶編碼）', () => {
      expect(readJson(utf8('[{}]'), 'auto')).toEqual({ ok: false, reason: 'noHeader' });
      expect(readYaml(utf8('- {}\n'), 'auto')).toEqual({ ok: false, reason: 'noHeader' });
    });

    it('YAML：語法錯誤讀不了', () => {
      expect(readYaml(utf8('- a: [1, 2\n'), 'auto')).toEqual({ ok: false, reason: 'unreadable' });
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

  describe('readSheet 依格式分派', () => {
    it.each([
      ['csv', utf8('email\na@example.com\n')],
      ['json', utf8('[{"email":"a@example.com"}]')],
      ['yaml', utf8('- email: a@example.com\n')],
    ] as const)('%s', async (format, bytes) => {
      expect(await readSheet(bytes, { format, encoding: 'auto' })).toMatchObject({
        ok: true,
        header: ['email'],
        rows: [{ cells: ['a@example.com'] }],
      });
    });

    it('xlsx 依指定的工作表', async () => {
      const workbook = new ExcelJS.Workbook();
      workbook.addWorksheet('Data').addRow(['email']);
      const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
      expect(await readSheet(bytes, { format: 'xlsx', encoding: 'auto', sheet: 'Nope' })).toEqual({
        ok: false,
        reason: 'sheetNotFound',
      });
      expect(await readSheet(bytes, { format: 'xlsx', encoding: 'auto' })).toMatchObject({
        ok: true,
        header: ['email'],
      });
    });
  });

  describe('worker thread 的進入點（§7.3）', () => {
    afterEach(() => {
      vi.doUnmock('node:worker_threads');
      vi.resetModules();
    });

    it('收到請求後以同一個 id 回傳解析結果', async () => {
      const port = await loadAsWorker();
      const request: ParseRequest = {
        id: 7,
        bytes: utf8('email\na@example.com\n'),
        options: { format: 'csv', encoding: 'auto' },
      };
      port.emit('message', request);
      await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalled());
      const response = port.postMessage.mock.calls[0]?.[0] as ParseResponse;
      expect(response).toMatchObject({ id: 7, result: { ok: true, header: ['email'] } });
    });

    it.each([
      ['Error 取訊息', new Error('炸了'), '炸了'],
      ['其他值轉字串', 'oops', 'oops'],
    ])('解析拋出例外時回傳 error（%s）', async (_name, thrown, expected) => {
      const port = await loadAsWorker();
      const options = {
        encoding: 'auto',
        get format(): never {
          throw thrown;
        },
      };
      port.emit('message', { id: 3, bytes: utf8(''), options });
      await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalled());
      expect(port.postMessage).toHaveBeenCalledWith({ id: 3, error: expected });
    });
  });
});
