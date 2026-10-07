import type { DraftRecord } from '@b2b-system/web-shared/storage';

import type { ImportMode } from '../data-transfer';
import { importDraftStore } from '../form';
import type { ImportState } from './importState';

/** 草稿的內容：預覽的狀態（不含復原記錄與待驗證：恢復時全部重新驗證）。 */
export type ImportDraft = Pick<
  ImportState,
  'mode' | 'fileName' | 'columns' | 'ignored' | 'rows' | 'results'
>;

function draftKey(type: string, mode: ImportMode): string {
  return `import:${type}:${mode}`;
}

export function saveImportDraft(owner: string, type: string, draft: ImportDraft): Promise<boolean> {
  return importDraftStore().save(owner, draftKey(type, draft.mode), draft);
}

export function loadImportDraft(
  owner: string,
  type: string,
  mode: ImportMode,
): Promise<DraftRecord<ImportDraft> | undefined> {
  return importDraftStore().load<ImportDraft>(owner, draftKey(type, mode));
}

export function removeImportDraft(owner: string, type: string, mode: ImportMode): Promise<void> {
  return importDraftStore().remove(owner, draftKey(type, mode));
}
