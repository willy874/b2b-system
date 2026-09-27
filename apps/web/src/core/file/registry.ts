import type { ComponentType } from 'react';

/**
 * 檔案管理的擴充點（docs/architecture/frontend/12-file-manager.md §6）。
 * feature 或 `plugins/` 在 plugin 的 **同步** 階段註冊；檔案管理器只依註冊表運作，不認識個別的格式。
 *
 * | 擴充 | 用途 | 內建 |
 * | ---- | ---- | ---- |
 * | 預覽解析器 `FilePreviewer` | LightBox 裡顯示檔案內容 | 圖片、純文字（`features/file`） |
 * | 檔案驗證器 `FileValidator` | 送進上傳佇列前檢查 | 大小上限、圖片檔頭（`features/file`） |
 * | 縮圖產生器 `ThumbnailGenerator` | 上傳時產生列表用的縮圖 | 瀏覽器能解碼的圖片（本資料夾） |
 */

/** 預覽需要的檔案資訊（`StoredFile` 的子集：解析器不必認識 API 的完整形狀）。 */
export interface FilePreviewSource {
  id: string;
  name: string;
  contentType: string;
  size: number;
  /** 直接讀取內容的網址（inline）；沒有時無法預覽。 */
  url: string | null;
}

export interface FilePreviewerProps {
  file: FilePreviewSource;
}

export interface FilePreviewer {
  id: string;
  /** 同一個檔案有多個解析器能處理時取較大者；內建為 0。 */
  priority?: number;
  /** 只看中繼資料判斷，不下載內容。 */
  canPreview: (file: FilePreviewSource) => boolean;
  /**
   * 超過這個大小（位元組）不預覽，改顯示「檔案太大」與下載鈕：
   * 預覽會把整個檔案下載到瀏覽器，1 GB 的文字檔會把分頁拖垮。
   */
  maxSize?: number;
  /** 大型解析器（PDF、3D 模型）請用 `React.lazy` 包裝，只在需要時載入。 */
  component: ComponentType<FilePreviewerProps>;
}

/** 驗證結果：`messageKey` 是完整字面量的語系 key（docs/conventions/06-literal-strings.md）。 */
export interface FileValidationIssue {
  validatorId: string;
  messageKey: string;
  params?: Record<string, unknown>;
}

export interface FileValidationContext {
  /** 後端的上傳政策（大小上限等）；還沒載入時為 `undefined`，驗證器應放行交給後端把關。 */
  maxSize?: number;
}

export interface FileValidator {
  id: string;
  /** 回 `undefined` 代表通過。可以讀檔案內容（例：檢查檔頭），但要快：每個檔案上傳前都會跑。 */
  validate: (
    file: File,
    context: FileValidationContext,
  ) => FileValidationIssue | undefined | Promise<FileValidationIssue | undefined>;
}

export interface ThumbnailOptions {
  /** 縮圖的長邊（px）。 */
  maxDimension: number;
  /** 產出的縮圖不可超過這個大小（位元組），超過就放棄（後端的 `thumbnailMaxSize`）。 */
  maxBytes: number;
  signal?: AbortSignal;
}

export interface ThumbnailGenerator {
  id: string;
  priority?: number;
  canGenerate: (file: File) => boolean;
  /** 產不出來（格式壞掉、瀏覽器不支援）回 `undefined`，不要拋錯：沒有縮圖不該讓上傳失敗。 */
  generate: (file: File, options: ThumbnailOptions) => Promise<Blob | undefined>;
}

const previewers = new Map<string, FilePreviewer>();
const validators = new Map<string, FileValidator>();
const thumbnailGenerators = new Map<string, ThumbnailGenerator>();

function registerUnique<T extends { id: string }>(
  registry: Map<string, T>,
  kind: string,
  entry: T,
): void {
  if (registry.has(entry.id)) throw new Error(`${kind} already registered: ${entry.id}`);
  registry.set(entry.id, entry);
}

const byPriority = <T extends { priority?: number }>(a: T, b: T) =>
  (b.priority ?? 0) - (a.priority ?? 0);

export function registerFilePreviewer(previewer: FilePreviewer): void {
  registerUnique(previewers, 'FilePreviewer', previewer);
}

/** 能處理這個檔案、優先順序最高的解析器；沒有時回 `undefined`（顯示類型圖示與下載鈕）。 */
export function resolveFilePreviewer(file: FilePreviewSource): FilePreviewer | undefined {
  return [...previewers.values()].toSorted(byPriority).find((entry) => entry.canPreview(file));
}

export function registerFileValidator(validator: FileValidator): void {
  registerUnique(validators, 'FileValidator', validator);
}

/** 跑過所有驗證器，回傳全部的問題（空陣列代表可以上傳）。單一驗證器拋錯視為通過，交給後端把關。 */
export async function validateFile(
  file: File,
  context: FileValidationContext,
): Promise<FileValidationIssue[]> {
  const results = await Promise.all(
    [...validators.values()].map(async (validator) => {
      try {
        return await validator.validate(file, context);
      } catch {
        return undefined;
      }
    }),
  );
  return results.filter((issue): issue is FileValidationIssue => issue !== undefined);
}

export function registerThumbnailGenerator(generator: ThumbnailGenerator): void {
  registerUnique(thumbnailGenerators, 'ThumbnailGenerator', generator);
}

/** 依優先順序找能處理的產生器；都產不出來回 `undefined`。 */
export async function createThumbnail(
  file: File,
  options: ThumbnailOptions,
): Promise<Blob | undefined> {
  const candidates = [...thumbnailGenerators.values()]
    .toSorted(byPriority)
    .filter((generator) => generator.canGenerate(file));
  for (const generator of candidates) {
    if (options.signal?.aborted) return undefined;
    try {
      const blob = await generator.generate(file, options);
      if (blob && blob.size <= options.maxBytes) return blob;
    } catch {
      // 換下一個產生器；全部失敗就沒有縮圖
    }
  }
  return undefined;
}

/** 測試用。 */
export function resetFileRegistry(): void {
  previewers.clear();
  validators.clear();
  thumbnailGenerators.clear();
}
