import { describe, expect, it } from 'vitest';

import { fileExtension, getFileKind, isBrowserImage } from '../fileType';

describe('getFileKind（MIME 優先，看不出來再看副檔名）', () => {
  it.each([
    ['image/png', 'a.png', 'image'],
    ['video/mp4', 'a.mp4', 'video'],
    ['audio/mpeg', 'a.mp3', 'audio'],
    ['text/plain', 'a.txt', 'text'],
    ['application/json', 'a.json', 'code'],
    ['text/csv', 'a.csv', 'spreadsheet'],
    ['application/pdf', 'a.pdf', 'pdf'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'a.xlsx', 'spreadsheet'],
    [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'a.pptx',
      'presentation',
    ],
    [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'a.docx',
      'document',
    ],
    ['application/zip', 'a.zip', 'archive'],
    ['font/woff2', 'a.woff2', 'font'],
    ['', 'shader.glsl', 'code'],
    ['application/octet-stream', 'level.lua', 'code'],
    ['application/octet-stream', 'unknown.bin', 'other'],
    ['', 'no-extension', 'other'],
  ])('%s + %s → %s', (contentType, name, kind) => {
    expect(getFileKind(contentType, name)).toBe(kind);
  });
});

describe('fileExtension', () => {
  it('取最後一個點之後、轉小寫；以點開頭的隱藏檔沒有副檔名', () => {
    expect(fileExtension('Archive.TAR.GZ')).toBe('gz');
    expect(fileExtension('.env')).toBe('');
  });
});

describe('isBrowserImage', () => {
  it('只認瀏覽器能直接顯示的格式', () => {
    expect(isBrowserImage('image/webp')).toBe(true);
    expect(isBrowserImage('image/tiff')).toBe(false);
  });
});
