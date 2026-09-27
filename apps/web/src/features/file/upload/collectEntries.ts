/** 要上傳的一個檔案，與它相對於放下位置的資料夾路徑。 */
export interface UploadEntry {
  file: File;
  /** 各層資料夾名稱（不含檔名）；直接選取或拖進來的檔案是空陣列。 */
  directories: readonly string[];
}

export interface CollectedUpload {
  entries: UploadEntry[];
  /** 遇到的每一個資料夾路徑（含空資料夾）：上傳資料夾時整個結構都要建出來。 */
  directories: string[][];
}

/** 作業系統自己產生、使用者不會想上傳的檔案。 */
const IGNORED_NAMES: ReadonlySet<string> = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

function isIgnored(name: string): boolean {
  return IGNORED_NAMES.has(name);
}

/**
 * `<input webkitdirectory>` 選到的檔案：以 `webkitRelativePath`（`素材/ui/button.png`）還原資料夾路徑。
 * 一般的多選檔案沒有相對路徑，資料夾路徑為空。
 */
export function collectFromFileList(files: Iterable<File>): CollectedUpload {
  const entries: UploadEntry[] = [];
  const directories = new Map<string, string[]>();
  for (const file of files) {
    if (isIgnored(file.name)) continue;
    const segments = (file.webkitRelativePath || file.name).split('/').filter(Boolean);
    const dirs = segments.slice(0, -1);
    entries.push({ file, directories: dirs });
    for (let depth = 1; depth <= dirs.length; depth += 1) {
      const path = dirs.slice(0, depth);
      directories.set(path.join('/'), path);
    }
  }
  return { entries, directories: [...directories.values()] };
}

function readFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** `readEntries` 一次最多回 100 筆（Chrome），要一直讀到回空陣列為止。 */
async function readAllEntries(directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = directory.createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- 下一批要等上一批讀完才能再呼叫 readEntries
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

function isFileEntry(entry: FileSystemEntry): entry is FileSystemFileEntry {
  return entry.isFile;
}

function isDirectoryEntry(entry: FileSystemEntry): entry is FileSystemDirectoryEntry {
  return entry.isDirectory;
}

async function walk(
  entry: FileSystemEntry,
  parents: readonly string[],
  result: CollectedUpload,
): Promise<void> {
  if (isFileEntry(entry)) {
    if (isIgnored(entry.name)) return;
    result.entries.push({ file: await readFile(entry), directories: parents });
    return;
  }
  if (!isDirectoryEntry(entry)) return;
  const path = [...parents, entry.name];
  result.directories.push(path);
  const children = await readAllEntries(entry);
  // 依序展開：保留結果的順序，也不同時對上萬個檔案發出讀取
  // oxlint-disable-next-line no-await-in-loop -- 見上
  for (const child of children) await walk(child, path, result);
}

/**
 * 拖放進來的東西（檔案與資料夾）展開成檔案清單，保留資料夾結構。
 *
 * `webkitGetAsEntry()` 只在 drop 事件的同步階段有效：這個函式在第一個 `await` 之前就把
 * 所有項目取出來，呼叫端直接在事件處理器裡呼叫即可。
 */
export function collectFromDataTransfer(dataTransfer: DataTransfer): Promise<CollectedUpload> {
  const items = Array.from(dataTransfer.items ?? []).filter((item) => item.kind === 'file');
  if (items.length === 0) return Promise.resolve(collectFromFileList(dataTransfer.files));
  const roots = items.map((item) => ({ entry: item.webkitGetAsEntry?.(), file: item.getAsFile() }));

  return (async () => {
    const result: CollectedUpload = { entries: [], directories: [] };
    for (const { entry, file } of roots) {
      // oxlint-disable-next-line no-await-in-loop -- 依序展開，理由同 walk()
      if (entry) await walk(entry, [], result);
      // 不支援 Entry API 的瀏覽器：只能拿到檔案本身
      else if (file && !isIgnored(file.name)) result.entries.push({ file, directories: [] });
    }
    return result;
  })();
}
