import ExcelJS from 'exceljs';

import { csvLine } from '../export/export-writers';

/** 範本與結果報告：小檔案，直接在記憶體組好回應（docs/architecture/backend/22-data-transfer.md §7.2、§7.7）。 */
export interface SheetData {
  name: string;
  header: readonly string[];
  rows: readonly (readonly string[])[];
}

/** CSV：UTF-8 加 BOM、CRLF（與匯出相同，Excel 才能正確辨識中文）。呼叫端先處理公式注入的前綴。 */
export function buildCsv(sheet: SheetData): Buffer {
  let text = '﻿' + csvLine(sheet.header);
  for (const row of sheet.rows) text += csvLine(row);
  return Buffer.from(text, 'utf8');
}

/** XLSX：每個 SheetData 一個工作表；標頭粗體、凍結。字串儲存格不會被解讀成公式。 */
export async function buildXlsx(sheets: readonly SheetData[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(
      sheet.name.replaceAll(/[\\/?*[\]:]/g, ' ').slice(0, 31),
      {
        views: [{ state: 'frozen', ySplit: 1 }],
      },
    );
    worksheet.columns = sheet.header.map((header) => ({
      header,
      width: Math.min(60, Math.max(10, header.length * 2 + 4)),
    }));
    worksheet.getRow(1).font = { bold: true };
    for (const row of sheet.rows) worksheet.addRow([...row]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export const SHEET_CONTENT_TYPE = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;
