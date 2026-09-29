import { useState } from 'react';

import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { useTranslation } from '@/core/locales';

import { canMoveFoldersTo } from '../folderTree';
import type { FolderIndex } from '../folderTree';
import type { DraggedItems } from '../useItemDrag';
import { FileFolderTree } from './FileFolderTree';

interface FileMoveDialogProps {
  /** 要移動的項目；`undefined` 時關閉。 */
  items: DraggedItems | undefined;
  folders: FolderIndex;
  pending: boolean;
  onMove: (items: DraggedItems, targetFolderId: string | undefined) => Promise<unknown>;
  onClose: () => void;
}

/**
 * 移動到…（拖放以外的替代方式：鍵盤、觸控、目的地不在畫面上時）。
 * 選不到的目的地：要移動的資料夾本身與它們的子孫；目前所在的位置可以選但「移動」鈕不可按。
 */
export function FileMoveDialog({ items, folders, pending, onMove, onClose }: FileMoveDialogProps) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<string | undefined>();
  const [openedFor, setOpenedFor] = useState<DraggedItems>();
  // 每次開啟從目前所在的位置開始（render 期間調整 state，不經過 effect）
  if (items !== openedFor) {
    setOpenedFor(items);
    setTarget(items?.sourceFolderId);
  }

  const count = (items?.fileIds.length ?? 0) + (items?.folderIds.length ?? 0);
  const valid =
    items !== undefined &&
    target !== items.sourceFolderId &&
    canMoveFoldersTo(folders, items.folderIds, target);

  return (
    <Dialog
      open={Boolean(items)}
      onOpenChange={(open) => !open && onClose()}
      title={t('file.move.title', { count })}
      size="sm"
      data-testid="file-move-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!valid}
            onClick={() => {
              if (!items || !valid) return;
              void onMove(items, target).then(onClose, () => undefined);
            }}
            data-testid="file-move-submit"
          >
            {t('file.move.action')}
          </Button>
        </>
      }
    >
      <FileFolderTree
        folders={folders}
        selectedId={target}
        onSelect={setTarget}
        isDisabled={(id) => !canMoveFoldersTo(folders, items?.folderIds ?? [], id)}
        className="max-h-80 overflow-auto rounded-md border border-[var(--color-border)] p-1"
        data-testid="file-move-tree"
      />
    </Dialog>
  );
}
