import { describe, expect, it } from 'vitest';

import { CreateFileUploadSchema, FileNameSchema } from '../create-file-upload.dto';
import { FileFolderNameSchema, UpdateFileFolderSchema } from '../file-folder.dto';
import { UpdateFileSchema } from '../update-file.dto';

/** 夾在名稱中間（頭尾的空白類字元會被 trim 掉）。 */
const named = (char: string) => `invoice${char}fdp.exe`;

describe('檔名與資料夾名稱的字元（docs/architecture/backend/09-file.md §4、§4.2）', () => {
  it.each([
    ['U+202E RLO（雙向文字控制）', '‮'],
    ['U+202A LRE', '‪'],
    ['U+2066 LRI', '⁦'],
    ['U+2069 PDI', '⁩'],
    ['U+200E LRM', '‎'],
    ['U+200F RLM', '‏'],
    ['U+061C ALM', '؜'],
    ['U+0085 NEL（C1）', '\u0085'],
    ['U+009B CSI（C1）', '\u009b'],
    ['U+0080（C1 的開頭）', '\u0080'],
    ['U+009F（C1 的結尾）', '\u009f'],
    ['U+200B 零寬空白', '​'],
    ['U+2028 行分隔', ' '],
    ['U+2029 段落分隔', ' '],
    ['U+FEFF BOM（夾在中間）', '﻿'],
    ['U+0007（C0）', '\u0007'],
    ['U+007F DEL', '\u007f'],
    ['/', '/'],
    ['\\', '\\'],
  ])('%s → 驗證失敗', (_name, char) => {
    expect(FileNameSchema.safeParse(named(char)).success).toBe(false);
    expect(FileFolderNameSchema.safeParse(named(char)).success).toBe(false);
  });

  it.each([
    ['一般中文', '角色 立繪.png'],
    ['全形字', 'ＡＢＣ（設計稿）.psd'],
    ['以 ZWJ 串起來的 emoji', '\u{1F468}‍\u{1F469} 合照.jpg'],
    ['ZWNJ（波斯文等需要）', 'می‌خواهم.txt'],
    ['阿拉伯文（本身是由右至左的文字，不是控制字元）', 'تقرير.pdf'],
    ['U+00A0 不斷行空白（不是 C1）', 'a b.txt'],
  ])('%s → 通過', (_name, name) => {
    expect(FileNameSchema.safeParse(name).success).toBe(true);
    expect(FileFolderNameSchema.safeParse(name).success).toBe(true);
  });

  it('上傳、改名、資料夾的建立與改名都套用同一個規則', () => {
    const bad = named('‮');
    expect(
      CreateFileUploadSchema.safeParse({ name: bad, contentType: 'text/plain', size: 1 }).success,
    ).toBe(false);
    expect(UpdateFileSchema.safeParse({ name: bad, version: 1 }).success).toBe(false);
    expect(UpdateFileFolderSchema.safeParse({ name: bad }).success).toBe(false);
  });

  it('頭尾的 BOM 與空白被 trim 掉，不算違規', () => {
    expect(FileNameSchema.parse('﻿a.txt ')).toBe('a.txt');
  });
});
