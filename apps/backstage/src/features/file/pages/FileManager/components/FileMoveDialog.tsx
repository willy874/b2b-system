import { Button } from '@b2b-system/ui/Button';
import { Collapsible } from '@b2b-system/ui/Collapsible';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Select } from '@b2b-system/ui/Select';
import type { SelectOption } from '@b2b-system/ui/Select';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useState } from 'react';

import { canMoveFoldersTo, childFolders, folderPath, ROOT_FOLDER } from '../folderTree';
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

/** 資料夾樹轉成下拉選單的選項：根目錄在最上層，子資料夾依名稱排序；有子資料夾的列也能選（`selectableGroups`）。 */
function folderOptions(
  folders: FolderIndex,
  parentId: string | undefined,
  isDisabled: (folderId: string | undefined) => boolean,
  lockedLabel: string,
): Array<SelectOption> {
  return childFolders(folders, parentId).map((folder) => {
    const children = folderOptions(folders, folder.id, isDisabled, lockedLabel);
    return {
      value: folder.id,
      label: folder.name,
      description: folder.capabilities.canRead === false ? lockedLabel : undefined,
      disabled: isDisabled(folder.id),
      children: children.length > 0 ? children : undefined,
    };
  });
}

/**
 * 移動到…（拖放以外的替代方式：鍵盤、觸控、目的地不在畫面上時）。
 * 主要以樹狀下拉選單選目的地；資料夾樹預設收合、展開後與選單連動（同一個目的地，選單選到的分支在樹上自動展開）。
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
  const isDisabled = (id: string | undefined) =>
    !canMoveFoldersTo(folders, items?.folderIds ?? [], id);
  const options: Array<SelectOption> = [
    {
      value: ROOT_FOLDER,
      label: t('file.folder.root'),
      disabled: isDisabled(undefined),
      children: folderOptions(folders, undefined, isDisabled, t('file.access.locked')),
    },
  ];
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
      <div className="flex flex-col gap-2">
        <Select
          options={options}
          selectableGroups
          searchable
          value={target ?? ROOT_FOLDER}
          onValueChange={(value) => setTarget(value === ROOT_FOLDER ? undefined : value)}
          // 開啟時根目錄與目前位置的上層都已展開
          defaultExpandedValues={[
            ROOT_FOLDER,
            ...folderPath(folders, items?.sourceFolderId).map((folder) => folder.id),
          ]}
          aria-label={t('file.move.target')}
          searchPlaceholder={t('file.move.search')}
          data-testid="file-move-target"
        />
        <Collapsible title={t('file.move.viewer')} testIds={{ trigger: 'file-move-tree-toggle' }}>
          <FileFolderTree
            folders={folders}
            selectedId={target}
            onSelect={setTarget}
            isDisabled={isDisabled}
            className="max-h-80 overflow-auto rounded-md border border-[var(--color-border)] p-1"
            data-testid="file-move-tree"
          />
        </Collapsible>
      </div>
    </Dialog>
  );
}
