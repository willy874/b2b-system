import { describe, expect, it } from 'vitest';

import { collectFromDataTransfer, collectFromFileList } from '../collectEntries';

function fileAt(relativePath: string): File {
  const name = relativePath.split('/').at(-1) ?? relativePath;
  const file = new File(['x'], name);
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
}

/** 以純物件模擬 Entry API（jsdom 沒有）；`readEntries` 分批回傳，驗證有讀到空陣列為止。 */
function fileEntry(name: string) {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (ok: (f: File) => void) => ok(new File(['x'], name)),
  };
}

function directoryEntry(name: string, children: unknown[]) {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      const batches = [children.slice(0, 1), children.slice(1), []];
      return { readEntries: (ok: (entries: unknown[]) => void) => ok(batches.shift() ?? []) };
    },
  };
}

function dataTransferOf(entries: unknown[]): DataTransfer {
  return {
    items: entries.map((entry) => ({
      kind: 'file',
      webkitGetAsEntry: () => entry,
      getAsFile: () => null,
    })),
    files: [],
  } as unknown as DataTransfer;
}

describe('collectEntries（上傳資料夾）', () => {
  it('webkitdirectory：以相對路徑還原資料夾，列出每一層（含中間層）', () => {
    const result = collectFromFileList([
      fileAt('素材/ui/button.png'),
      fileAt('素材/bg.png'),
      fileAt('素材/.DS_Store'),
    ]);
    expect(result.entries.map((e) => [e.file.name, e.directories])).toEqual([
      ['button.png', ['素材', 'ui']],
      ['bg.png', ['素材']],
    ]);
    expect(result.directories).toEqual([['素材'], ['素材', 'ui']]);
  });

  it('一般多選檔案沒有資料夾', () => {
    const result = collectFromFileList([new File(['x'], 'a.txt')]);
    expect(result.entries[0]?.directories).toEqual([]);
    expect(result.directories).toEqual([]);
  });

  it('拖放：遞迴展開資料夾（含空資料夾），分批的 readEntries 讀到完為止', async () => {
    const dropped = dataTransferOf([
      directoryEntry('pack', [
        fileEntry('a.png'),
        directoryEntry('empty', []),
        directoryEntry('sfx', [fileEntry('hit.wav'), fileEntry('Thumbs.db')]),
      ]),
      fileEntry('loose.txt'),
    ]);
    const result = await collectFromDataTransfer(dropped);

    expect(result.entries.map((e) => [e.directories.join('/'), e.file.name])).toEqual([
      ['pack', 'a.png'],
      ['pack/sfx', 'hit.wav'],
      ['', 'loose.txt'],
    ]);
    expect(result.directories).toEqual([['pack'], ['pack', 'empty'], ['pack', 'sfx']]);
  });
});
