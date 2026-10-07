import ExcelJS from 'exceljs';

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

async function write(format: 'csv' | 'xlsx' | 'sql'): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const writer = createExportWriter(
    format,
    columns as TransferColumn<unknown>[],
    ctx,
    { write: (chunk) => chunks.push(chunk) },
    meta,
  );
  await writer.start();
  await writer.write(rows);
  await writer.finish(rows.length);
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
});
