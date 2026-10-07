import { Checkbox } from '@b2b-system/ui/Checkbox';
import type { TableSelection } from '@b2b-system/ui/Table';
import { useMemo } from 'react';

import type { BatchAction } from '../batch';
import { BatchBar } from '../components/RichTable';
import { useTranslation } from '../locales';

/** 批次操作需要的最少欄位：兩個 app 的 `NotificationVM` 都有。 */
export interface NotificationBatchItem {
  id: string;
  isRead: boolean;
}

export interface NotificationBatchBarProps<TItem extends NotificationBatchItem> {
  /** 這個列表在全域佇列裡的識別：送出的工作進行中時，操作列換成進度條。 */
  scope: string;
  /** 目前列表上的通知（已載入的、這一頁的）。 */
  items: readonly TItem[];
  /** 由列表以 `useTableSelection(items, (item) => item.id)` 建立；每一列的勾選框也用它。 */
  selection: TableSelection<TItem>;
  /** 佇列面板與結果對話框列出項目時顯示的名稱（翻譯好的句子）。 */
  getLabel: (item: TItem) => string;
  /** app 註冊的批次操作 id（`registerBatchOperation`，逐筆呼叫自己的單筆端點）。 */
  operations: { markRead: string; delete: string };
}

const getId = (item: NotificationBatchItem) => item.id;

/**
 * 通知列表上方的「全選」與批次操作列（兩個前端共用；docs/architecture/frontend/15-notification.md §4）。
 * 全選只涵蓋目前列表上的通知（無限捲動是已載入的、分頁是這一頁的）；操作列是 `RichTable` 同一套 `BatchBar`。
 * 「標為已讀」把已讀的算略過；「刪除」已讀未讀都送出。
 */
export function NotificationBatchBar<TItem extends NotificationBatchItem>({
  scope,
  items,
  selection,
  getLabel,
  operations,
}: NotificationBatchBarProps<TItem>) {
  const { t } = useTranslation();
  const selected = new Set(selection.selectedIds);
  const selectedCount = items.filter((item) => selected.has(item.id)).length;

  const actions = useMemo<BatchAction<TItem>[]>(
    () => [
      {
        id: 'markRead',
        label: t('notificationBatch.markRead.action'),
        tone: 'primary',
        isEligible: (item) => !item.isRead,
        ineligibleReason: t('notificationBatch.markRead.ineligible'),
        confirm: ({ eligible }) => ({
          title: t('notificationBatch.markRead.title'),
          description: t('notificationBatch.markRead.confirm', { count: eligible.length }),
        }),
        operation: operations.markRead,
      },
      {
        id: 'delete',
        label: t('notificationBatch.delete.action'),
        tone: 'danger',
        isEligible: () => true,
        confirm: ({ eligible }) => ({
          title: t('notificationBatch.delete.title'),
          description: t('notificationBatch.delete.confirm', { count: eligible.length }),
        }),
        operation: operations.delete,
      },
    ],
    [operations.delete, operations.markRead, t],
  );

  if (items.length === 0) return null;

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-3">
      <span className="pl-4">
        <Checkbox
          checked={selectedCount === items.length}
          indeterminate={selectedCount > 0 && selectedCount < items.length}
          onCheckedChange={(checked) =>
            selection.onRowSelectionChange(
              checked ? Object.fromEntries(items.map((item) => [item.id, true])) : {},
            )
          }
          label={t('notificationBatch.selectAll', { count: items.length })}
          data-testid="notification-select-all"
        />
      </span>
      <div className="min-w-0 flex-1">
        <BatchBar
          batch={{ scope, selection, actions, getRowLabel: getLabel }}
          getRowId={getId}
          pageRows={items}
        />
      </div>
    </div>
  );
}

/** 列上的勾選框改變時，交給 `selection` 的下一個狀態（保留其他已勾的）。 */
export function toggleNotificationSelection<TItem extends NotificationBatchItem>(
  selection: TableSelection<TItem>,
  id: string,
  checked: boolean,
): void {
  const next = new Set(selection.selectedIds);
  if (checked) next.add(id);
  else next.delete(id);
  selection.onRowSelectionChange(Object.fromEntries([...next].map((key) => [key, true])));
}
