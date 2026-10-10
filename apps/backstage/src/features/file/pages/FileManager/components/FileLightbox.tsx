import { Button, IconButton } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Empty } from '@b2b-system/ui/Empty';
import { Icon } from '@b2b-system/ui/Icon';
import { Spinner } from '@b2b-system/ui/Spinner';
import { isAppError } from '@b2b-system/web-core/errors';
import { isTypingTarget } from '@b2b-system/web-core/hotkey';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { getFileDetailQueryOptions } from '@/apis/file/get-file-detail/query';
import { TagChips } from '@/core/components';
import { resolveFilePreviewer } from '@/core/file';

import { FILE_KIND_LABEL_KEY } from '../../../constants';
import { toFileItemVM } from '../adapter';
import type { FileItemVM } from '../adapter';
import { FileActionButtons } from './FileActionButtons';
import { PreviewBoundary } from './PreviewBoundary';

interface FileLightboxProps {
  /** 開著的檔案；`undefined` 時關閉。 */
  fileId: string | undefined;
  /** 目前列表載入的項目：上一個／下一個在這之中切換，也當作詳情載入前的佔位資料。 */
  items: readonly FileItemVM[];
  onNavigate: (fileId: string) => void;
  onClose: () => void;
  /** 頁面層級（權限已水合）；個別檔案另外看自己的 `canUpdate` / `canDelete`。 */
  canRename: boolean;
  canDelete: boolean;
  onRename: (file: FileItemVM) => void;
  onDelete: (file: FileItemVM) => void;
}

/** 先把上一個、下一個的圖片抓進快取：切換時立刻顯示。 */
function usePreloadNeighbors(neighbors: ReadonlyArray<FileItemVM | undefined>): void {
  const urls = neighbors.flatMap((item) => {
    const url = item?.kind === 'image' ? (item.displayUrl ?? item.url) : null;
    return url ? [url] : [];
  });
  const key = urls.join('\n');
  useEffect(() => {
    if (!key) return;
    for (const url of key.split('\n')) {
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
    }
  }, [key]);
}

/**
 * 檔案詳情（docs/architecture/frontend/12-file-manager.md §6）。內容由 `core/file` 註冊表中能處理這個檔案的
 * 預覽解析器顯示；沒有解析器、或檔案超過解析器的大小上限時顯示類型圖示與下載鈕。
 *
 * 詳情另外向後端查詢（`GET /files/:id`）：拿到最新的名稱、版本與網址；別人刪除了就顯示「已刪除」。
 */
export function FileLightbox({
  fileId,
  items,
  onNavigate,
  onClose,
  canRename,
  canDelete,
  onRename,
  onDelete,
}: FileLightboxProps) {
  const { t } = useTranslation();
  const detail = useQuery({ ...getFileDetailQueryOptions(fileId ?? ''), enabled: Boolean(fileId) });
  const index = fileId ? items.findIndex((item) => item.id === fileId) : -1;
  const listed = index >= 0 ? items[index] : undefined;
  const file = detail.data ? toFileItemVM(detail.data) : listed;
  const deleted = isAppError(detail.error) && detail.error.code === 'FILE_NOT_FOUND';
  const previous = index > 0 ? items[index - 1] : undefined;
  const next = index >= 0 ? items[index + 1] : undefined;
  usePreloadNeighbors([previous, next]);

  // ← / → 切換。用 capture：Base UI Dialog 的焦點管理會在事件冒泡到 window 之前停止傳遞。
  // 輸入框（改名）與自己處理方向鍵的控制項（下拉選單、清單）不攔截
  useEffect(() => {
    if (!fileId) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      if (event.key === 'ArrowLeft' && previous) onNavigate(previous.id);
      if (event.key === 'ArrowRight' && next) onNavigate(next.id);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [fileId, next, onNavigate, previous]);

  let body: ReactNode;
  if (deleted) {
    body = (
      <Empty
        title={t('file.preview.deleted')}
        description={t('file.preview.deletedDescription')}
        data-testid="file-preview-deleted"
      />
    );
  } else if (!file) {
    body = (
      <div className="flex h-full items-center justify-center">
        <Spinner label={t('common.loading')} />
      </div>
    );
  } else {
    body = <FilePreviewPane file={file} />;
  }

  return (
    <Dialog
      open={Boolean(fileId)}
      onOpenChange={(open) => !open && onClose()}
      title={
        <span className="flex items-center gap-2" data-testid="file-lightbox-title">
          <span className="truncate">{file?.name ?? t('file.preview.title')}</span>
          {items.length > 0 && index >= 0 && (
            <span className="shrink-0 text-xs font-normal text-[var(--color-fg-muted)]">
              {index + 1} / {items.length}
            </span>
          )}
        </span>
      }
      className="h-[92dvh] !max-w-[min(96vw,1400px)]"
      classNames={{ body: 'flex min-h-0 flex-col gap-4 md:flex-row' }}
      data-testid="file-lightbox"
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <IconButton
            aria-label={t('file.preview.previous')}
            disabled={!previous}
            onClick={() => previous && onNavigate(previous.id)}
            data-testid="file-lightbox-previous"
          >
            <Icon name="chevron-left" size={16} />
          </IconButton>
          <IconButton
            aria-label={t('file.preview.next')}
            disabled={!next}
            onClick={() => next && onNavigate(next.id)}
            data-testid="file-lightbox-next"
          >
            <Icon name="chevron-right" size={16} />
          </IconButton>
          <span className="ml-auto flex flex-wrap gap-2">
            {file && !deleted && canRename && file.canUpdate && (
              <Button
                variant="secondary"
                startIcon={<Icon name="edit" size={14} />}
                onClick={() => onRename(file)}
                data-testid="file-lightbox-rename"
              >
                {t('file.rename.action')}
              </Button>
            )}
            {file && !deleted && canDelete && file.canDelete && (
              <Button
                variant="danger"
                startIcon={<Icon name="trash" size={14} />}
                onClick={() => onDelete(file)}
                data-testid="file-lightbox-delete"
              >
                {t('common.delete')}
              </Button>
            )}
            {/* 其他 feature 登記的檔案動作（core/file 的 registerFileAction）；沒有登記時不渲染 */}
            {file && !deleted && <FileActionButtons placement="lightbox" files={[file]} />}
            {file?.downloadUrl && !deleted && (
              <a
                href={file.downloadUrl}
                download={file.name}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--color-brand)] px-3 text-sm font-medium text-[var(--color-brand-fg)] no-underline hover:bg-[var(--color-brand-hover)]"
                data-testid="file-lightbox-download"
              >
                <Icon name="download" size={14} />
                {t('file.download')}
              </a>
            )}
          </span>
        </div>
      }
    >
      <div className="flex min-h-[40dvh] min-w-0 flex-1 flex-col">{body}</div>
      {file && !deleted && <FileDetails file={file} />}
    </Dialog>
  );
}

function FilePreviewPane({ file }: { file: FileItemVM }) {
  const { t } = useTranslation();
  const previewer = resolveFilePreviewer(file);
  const tooLarge = previewer?.maxSize !== undefined && file.size > previewer.maxSize;
  const fallback = (
    <Empty
      title={t('file.preview.unavailable')}
      description={tooLarge ? t('file.preview.tooLarge') : t('file.preview.unsupported')}
      data-testid="file-preview-unavailable"
    />
  );
  if (!previewer || tooLarge) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <span className="text-[var(--color-fg-muted)]">
          <Icon name={file.icon} size={24} />
        </span>
        {fallback}
      </div>
    );
  }
  const Preview = previewer.component;
  return (
    <PreviewBoundary key={file.id} fallback={fallback}>
      <div className="h-full min-h-0" data-testid="file-preview" data-value={previewer.id}>
        <Preview file={file} />
      </div>
    </PreviewBoundary>
  );
}

function FileDetails({ file }: { file: FileItemVM }) {
  const { t } = useTranslation();
  const rows: Array<{ key: string; label: string; value: ReactNode }> = [
    {
      key: 'name',
      label: t('file.field.name'),
      value: <span className="break-all">{file.name}</span>,
    },
    { key: 'kind', label: t('file.field.kind'), value: t(FILE_KIND_LABEL_KEY[file.kind]) },
    {
      key: 'contentType',
      label: t('file.field.contentType'),
      value: <code className="text-xs">{file.contentType}</code>,
    },
    { key: 'size', label: t('file.field.size'), value: file.sizeLabel },
    {
      key: 'tags',
      label: t('file.field.tags'),
      value: <TagChips tags={file.tags} empty="—" data-testid="file-details-tags" />,
    },
    { key: 'uploader', label: t('file.field.uploader'), value: file.uploaderName ?? '—' },
    { key: 'createdAt', label: t('file.field.createdAt'), value: formatDateTime(file.createdAt) },
    { key: 'updatedAt', label: t('file.field.updatedAt'), value: formatDateTime(file.updatedAt) },
  ];
  return (
    <aside
      className="shrink-0 overflow-auto border-t border-[var(--color-border)] pt-3 text-sm md:w-72 md:border-t-0 md:border-l md:pt-0 md:pl-4"
      data-testid="file-details"
    >
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
        {rows.map(({ key, label, value }) => (
          <div key={key} className="contents">
            <dt className="text-[var(--color-fg-muted)]">{label}</dt>
            <dd className="m-0 min-w-0">{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
