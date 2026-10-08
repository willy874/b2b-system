import ExcelJS from 'exceljs';
import { parse as parseYaml } from 'yaml';

import type { TransferColumn } from '../data-transfer.types';
import { createExportWriter, csvField } from '../export/export-writers';

interface Row {
  name: string;
  count: number;
  at: Date;
  tags: string[];
}

const columns: TransferColumn<Row>[] = [
  {
    key: 'name',
    label: { 'zh-TW': '名稱', 'en-US': 'Name' },
    kind: 'string',
    export: { get: (row) => row.name },
  },
  {
    key: 'count',
    label: { 'zh-TW': '數量', 'en-US': 'Count' },
    kind: 'number',
    export: { get: (row) => row.count },
  },
  {
    key: 'at',
    label: { 'zh-TW': '時間', 'en-US': 'At' },
    kind: 'datetime',
    export: { get: (row) => row.at },
  },
  {
    key: 'tags',
    label: { 'zh-TW': '標籤', 'en-US': 'Tags' },
    kind: 'string',
    multiple: {},
    export: { get: (row) => row.tags },
  },
];
const rows: Row[] = [
  { name: '=1+1', count: -5, at: new Date('2026-10-08T06:30:00Z'), tags: ['a', 'b'] },
  { name: 'line\nbreak "quoted"', count: 3, at: new Date('2026-01-01T00:00:00Z'), tags: [] },
];
const ctx = { locale: 'zh-TW', timezone: 'Asia/Taipei' } as const;
const meta = {
  fileBaseName: 'things',
  label: '東西',
  generatedAt: new Date(),
  generatedBy: 'a@example.com',
};

async function write(
  format: 'csv' | 'xlsx' | 'json' | 'yaml' | 'sql',
  records: readonly Row[] = rows,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const writer = createExportWriter(
    format,
    columns as TransferColumn<unknown>[],
    ctx,
    { write: (chunk) => chunks.push(chunk) },
    meta,
  );
  await writer.start();
  // 分兩頁寫，確認逐頁寫出的結果仍是一份合法的檔案
  await writer.write(records.slice(0, 1));
  await writer.write(records.slice(1));
  await writer.finish(records.length);
  return Buffer.concat(chunks);
}

describe('匯出的寫檔器（docs/architecture/backend/22-data-transfer.md §6.5）', () => {
  it('CSV：RFC 4180 的引號與跳脫', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField(' padded')).toBe('" padded"');
  });

  it('CSV：BOM、CRLF、公式注入只加在文字欄、多值以 ; 串接', async () => {
    const text = (await write('csv')).toString('utf8');
    expect(text).toBe(
      '﻿名稱,數量,時間,標籤\r\n' +
        "'=1+1,-5,2026-10-08T14:30:00+08:00,a;b\r\n" +
        '"line\nbreak ""quoted""",3,2026-01-01T08:00:00+08:00,\r\n',
    );
  });

  it('SQL：CREATE TABLE ＋ INSERT，交易包住', async () => {
    const text = (await write('sql')).toString('utf8');
    expect(text).toContain(
      'CREATE TABLE IF NOT EXISTS "things_export" (\n  "name" text,\n  "count" numeric,\n  "at" timestamptz,\n  "tags" text[]\n);',
    );
    expect(text).toContain(`('=1+1', -5, '2026-10-08T06:30:00.000Z', ARRAY['a', 'b'])`);
    expect(text).toContain(`('line\nbreak "quoted"', 3, '2026-01-01T00:00:00.000Z', '{}'::text[])`);
    expect(text).toMatch(/-- 2 rows\nCOMMIT;\n$/);
  });

  it('XLSX：數字是數值儲存格、字串不加前綴、標頭凍結', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await write('xlsx')) as never);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.name).toBe('東西');
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.getCell('A2').value).toBe('=1+1');
    expect(sheet.getCell('B2').value).toBe(-5);
    // 牆上時間：台北的 14:30
    expect((sheet.getCell('C2').value as Date).toISOString()).toBe('2026-10-08T14:30:00.000Z');
    expect(sheet.getCell('D2').value).toBe('a;b');
  });

  const expectedRecords = [
    { name: '=1+1', count: -5, at: '2026-10-08T14:30:00+08:00', tags: ['a', 'b'] },
    { name: 'line\nbreak "quoted"', count: 3, at: '2026-01-01T08:00:00+08:00', tags: [] },
  ];

  it('JSON：以欄位 key 為鍵的物件陣列，保留數字與多值的型別，不加公式前綴', async () => {
    const text = (await write('json')).toString('utf8');
    expect(JSON.parse(text)).toEqual(expectedRecords);
    // 一筆一行：大檔案逐頁寫出，不必整份組成一個物件
    expect(text.split('\n')).toHaveLength(5);
  });

  it('YAML：與 JSON 相同的內容；字串照 YAML 的規則加引號，讀回來型別不變', async () => {
    const text = (await write('yaml')).toString('utf8');
    expect(parseYaml(text)).toEqual(expectedRecords);
  });

  it('JSON／YAML：沒有資料時仍是空陣列', async () => {
    expect(JSON.parse((await write('json', [])).toString('utf8'))).toEqual([]);
    expect(parseYaml((await write('yaml', [])).toString('utf8'))).toEqual([]);
  });
});
