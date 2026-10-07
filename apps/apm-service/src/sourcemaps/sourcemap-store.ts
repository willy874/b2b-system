import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

import { ApmError } from '@/http/errors';

const RELEASE_PATTERN = /^[A-Za-z0-9._+-]{1,100}$/;
const SEGMENT_PATTERN = /^[A-Za-z0-9._@+-]{1,200}$/;

export interface ReleaseFile {
  /** Sentry 的 release file id；這裡用名稱的雜湊。 */
  id: string;
  /** Sentry 慣例的名稱：`~/assets/index-abc123.js.map`。 */
  name: string;
  size: number;
  sha1: string;
  dateCreated: string;
}

export function assertRelease(release: string): void {
  if (!RELEASE_PATTERN.test(release)) {
    throw new ApmError(400, 'release 只能包含英數字與 . _ + -，最多 100 字');
  }
}

/**
 * 上傳時的名稱 → 相對路徑。接受 Sentry 的 `~/assets/x.js.map`、完整網址或 `/assets/x.js.map`；
 * 結果是 `assets/x.js.map`。不允許 `..`、空段落與奇怪的字元（防止寫到資料夾外）。
 */
export function toRelativePath(name: string): string {
  let path = name.trim();
  if (path.startsWith('~/')) path = path.slice(2);
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      throw new ApmError(400, `檔名不是合法的網址：${name}`);
    }
  }
  path = path.replace(/^\/+/, '');
  const segments = path.split('/');
  if (
    segments.length === 0 ||
    segments.length > 10 ||
    segments.some(
      (segment) => segment === '.' || segment === '..' || !SEGMENT_PATTERN.test(segment),
    )
  ) {
    throw new ApmError(400, `不接受的檔名：${name}`);
  }
  return segments.join('/');
}

function fileId(name: string): string {
  return createHash('sha1').update(name).digest('hex').slice(0, 16);
}

/**
 * sourcemap 存在 `<dataDir>/sourcemaps/<project>/<release>/<相對路徑>`（docs/architecture/frontend/19-observability.md §9.2 D4）。
 * 和 apps/file-storage 一樣，`.data/` 就是儲存空間；換成物件儲存時只換這個類別。
 */
export class SourcemapStore {
  private constructor(private readonly root: string) {}

  static async open(dataDir: string): Promise<SourcemapStore> {
    const root = join(dataDir, 'sourcemaps');
    await mkdir(root, { recursive: true });
    return new SourcemapStore(root);
  }

  private releaseDir(project: string, release: string): string {
    assertRelease(release);
    return join(this.root, project, release);
  }

  async save(
    project: string,
    release: string,
    name: string,
    content: Buffer,
  ): Promise<ReleaseFile> {
    const relativePath = toRelativePath(name);
    const target = join(this.releaseDir(project, release), ...relativePath.split('/'));
    try {
      await stat(target);
      throw new ApmError(409, '這個 release 已經有同名的檔案');
    } catch (error) {
      if (error instanceof ApmError) throw error;
    }
    await mkdir(dirname(target), { recursive: true });
    // 先寫暫存檔再改名：讀取端不會讀到寫一半的 sourcemap
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, content);
    await rename(temporary, target);
    const canonical = `~/${relativePath}`;
    return {
      id: fileId(canonical),
      name: canonical,
      size: content.length,
      sha1: createHash('sha1').update(content).digest('hex'),
      dateCreated: new Date().toISOString(),
    };
  }

  async list(project: string, release: string): Promise<ReleaseFile[]> {
    const base = this.releaseDir(project, release);
    let entries: string[];
    try {
      entries = await readdir(base, { recursive: true });
    } catch {
      return [];
    }
    const describe = async (entry: string): Promise<ReleaseFile | undefined> => {
      const absolute = join(base, entry);
      const info = await stat(absolute);
      if (!info.isFile() || entry.endsWith('.tmp')) return undefined;
      const canonical = `~/${relative(base, absolute).split(sep).join('/')}`;
      return {
        id: fileId(canonical),
        name: canonical,
        size: info.size,
        sha1: createHash('sha1')
          .update(await readFile(absolute))
          .digest('hex'),
        dateCreated: info.mtime.toISOString(),
      };
    };
    const files = (await Promise.all(entries.toSorted().map(describe))).filter(
      (file): file is ReleaseFile => file !== undefined,
    );
    return files;
  }

  /** 讀出某個 release 的檔案；沒有時回 `undefined`。 */
  async read(project: string, release: string, relativePath: string): Promise<string | undefined> {
    let path: string;
    try {
      assertRelease(release);
      path = toRelativePath(relativePath);
    } catch {
      return undefined;
    }
    try {
      return await readFile(join(this.root, project, release, ...path.split('/')), 'utf8');
    } catch {
      return undefined;
    }
  }

  /** 刪掉整個 release 的 sourcemap（測試與手動清理用）。 */
  async removeRelease(project: string, release: string): Promise<void> {
    await rm(this.releaseDir(project, release), { recursive: true, force: true });
  }
}
