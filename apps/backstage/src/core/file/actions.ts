import type { IconName } from '@b2b-system/ui/Icon';
import { i18n, loadLocaleScope } from '@b2b-system/web-core/locales';
import { useStore } from '@b2b-system/web-shared/hooks';
import { createRegistry } from '@b2b-system/web-shared/registry';
import { useEffect, useMemo } from 'react';
import type { ComponentType } from 'react';

import { usePermission } from '@/core/permission';
import type { PermissionKey } from '@/core/permission';

/**
 * 檔案管理器上列出動作的位置。檔案管理器目前沒有右鍵選單，所以沒有 `contextMenu`；
 * 之後加右鍵選單時再加一種位置（docs/architecture/frontend/12-file-manager.md §6.2）。
 */
export type FileActionPlacement = 'selectionBar' | 'lightbox';

/** 動作看得到的檔案資訊（`StoredFile` 的子集：動作不必認識 API 的完整形狀）。 */
export interface FileActionTarget {
  id: string;
  name: string;
  contentType: string;
  size: number;
}

/** 一個檔案能不能處理；不能時 `reasonKey` 是完整字面量的語系 key（在動作的 `localeScope` 裡）。 */
export type FileActionCheck =
  | { ok: true }
  | { ok: false; reasonKey: string; params?: Record<string, unknown> };

/** 被 `check` 略過的檔案與原因。 */
export interface FileActionSkipped {
  file: FileActionTarget;
  reasonKey: string;
  params?: Record<string, unknown>;
}

export interface FileActionDialogProps {
  /** `check` 通過的檔案（檔案管理器已過濾，至少一個）。 */
  files: readonly FileActionTarget[];
  /** `check` 不通過的檔案：動作在結果裡列出「略過幾個、為什麼」。 */
  skipped: readonly FileActionSkipped[];
  /** 檔案管理器自己登記的後端圖片來源 id（目前是 `'file'`），由檔案管理器提供，動作不寫死。 */
  sourceId: string;
  onClose: () => void;
}

export interface FileActionDefinition {
  /** 唯一的名稱，例：`gallery.add`。 */
  id: string;
  /** 同一個位置上的順序（小的在前）；省略為 0。列在檔案管理器自己的按鈕之後。 */
  order?: number;
  /** 完整字面量的語系 key（docs/coding-standards/06-literal-strings.md）。 */
  labelKey: string;
  /** 動作的語系包 scope（`labelKey`、`reasonKey` 在這個 scope）；`useFileActions` 列出時以 `loadLocaleScope` 載入。 */
  localeScope?: string;
  icon: IconName;
  placement: readonly FileActionPlacement[];
  /** 權限（同步）；省略＝看得到檔案管理器就能用。權限還沒水合時一律不列出。 */
  isAvailable?: (context: { can: (key: PermissionKey) => boolean }) => boolean;
  /** 每個選取的檔案能不能處理；省略＝全部可以。只看中繼資料，不下載內容。 */
  check?: (file: FileActionTarget) => FileActionCheck;
  /** 按下後由檔案管理器渲染（外面包 `Suspense`，可以用 `React.lazy`）；關閉時呼叫 `onClose`。 */
  component: ComponentType<FileActionDialogProps>;
}

/** 可訂閱：feature 在執行期安裝或卸載時，按鈕跟著出現或消失（docs/architecture/frontend/02-plugin-system.md §9.2 D4）。 */
const fileActions = createRegistry<string, FileActionDefinition>('File action');

/** 在 plugin 的同步階段登記；重複登記同一個 `id` 丟例外。回傳反註冊函式。 */
export function registerFileAction(action: FileActionDefinition): () => void {
  return fileActions.register(action.id, action);
}

/**
 * 這個位置上可以用的動作：依 `order` 排、以 `isAvailable` 過濾（權限未水合時是空陣列），
 * 並載入它們的語系包（載入後 `useTranslation` 讓按鈕重渲染）。
 */
export function useFileActions(placement: FileActionPlacement): FileActionDefinition[] {
  const entries = useStore(fileActions.store, (state) => state.entries);
  const { hydrated, can } = usePermission();
  const actions = useMemo(
    () =>
      hydrated
        ? [...entries.values()]
            .filter((action) => action.placement.includes(placement))
            .filter((action) => action.isAvailable?.({ can }) ?? true)
            .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0))
        : [],
    [entries, placement, hydrated, can],
  );
  useEffect(() => {
    for (const { localeScope } of actions) {
      // 失敗時不記成已載入，下一次列出時重試；畫面暫時顯示 key
      if (localeScope) loadLocaleScope(localeScope, i18n.language).catch(() => undefined);
    }
  }, [actions]);
  return actions;
}

/** 以動作的 `check` 把檔案分成可以處理與略過的兩組（順序不變）。 */
export function partitionFileActionTargets(
  action: Pick<FileActionDefinition, 'check'>,
  files: readonly FileActionTarget[],
): { files: FileActionTarget[]; skipped: FileActionSkipped[] } {
  const accepted: FileActionTarget[] = [];
  const skipped: FileActionSkipped[] = [];
  for (const file of files) {
    const result = action.check?.(file) ?? { ok: true };
    if (result.ok) accepted.push(file);
    else skipped.push({ file, reasonKey: result.reasonKey, params: result.params });
  }
  return { files: accepted, skipped };
}

/** 測試用（`resetFileRegistry()` 會呼叫）。 */
export function resetFileActions(): void {
  fileActions.reset();
}
