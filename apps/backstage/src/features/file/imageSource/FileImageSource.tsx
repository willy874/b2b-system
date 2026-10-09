import { Button } from '@b2b-system/ui/Button';
import { Empty } from '@b2b-system/ui/Empty';
import { Select } from '@b2b-system/ui/Select';
import type { SelectOption } from '@b2b-system/ui/Select';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import type { ImageSourceProps, ImageUsage } from '@b2b-system/web-core/image-picker';
import { isLargeEnough } from '@b2b-system/web-core/image-picker';
import { useTranslation } from '@b2b-system/web-core/locales';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getFileFolderListQueryOptions } from '@/apis/file/get-file-folder-list/query';
import { getFileListQueryOptions } from '@/apis/file/get-file-list/query';
import type { StoredFile } from '@/shared/api-sdk';

import { FILE_IMAGE_SOURCE_ID } from '../constants';
import { buildFolderIndex, childFolders, ROOT_FOLDER } from '../pages/FileManager/folderTree';
import type { FolderIndex } from '../pages/FileManager/folderTree';

/** 一頁幾張：縮圖格一次放得下，再多就按「載入更多」。 */
const PAGE_SIZE = 48;
const NO_ROOT_ACCESS = { canCreate: false };

function folderOptions(folders: FolderIndex, parentId: string | undefined): SelectOption[] {
  return childFolders(folders, parentId)
    .filter((folder) => folder.capabilities.canRead !== false)
    .map((folder) => {
      const children = folderOptions(folders, folder.id);
      return {
        value: folder.id,
        label: folder.name,
        children: children.length > 0 ? children : undefined,
      };
    });
}

/** 太小的圖列出但停用（使用者記得檔案管理器裡有那張圖，找不到會以為壞了）；變體還沒好（沒有尺寸）先當作可選。 */
function unusableReason(file: StoredFile, usage: ImageUsage): 'small' | undefined {
  if (!file.image) return undefined;
  return isLargeEnough(file.image, usage) ? undefined : 'small';
}

/**
 * 來源「檔案管理」（docs/architecture/frontend/23-image-picker.md §7）：唯讀、單選的資料夾＋縮圖格。
 * 伺服器已濾掉不能用的（型別、大小、處理失敗，`imageUsage`）；選了之後由伺服器複製成一張新的圖片，
 * 原檔之後被移動、刪除都不影響。看不到任何資料夾時照樣顯示，提示改用上傳。
 */
export function FileImageSource({ usage, onSelect }: ImageSourceProps) {
  const { t } = useTranslation();
  const [folderId, setFolderId] = useState<string>(ROOT_FOLDER);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const folderList = useQuery(getFileFolderListQueryOptions());
  const folders = useMemo(
    () =>
      buildFolderIndex(
        folderList.data?.items ?? [],
        folderList.data?.rootCapabilities ?? NO_ROOT_ACCESS,
      ),
    [folderList.data],
  );
  const files = useQuery({
    ...getFileListQueryOptions({
      params: {
        folderId,
        imageUsage: usage.id,
        offset: 0,
        limit,
        sort: [{ sort: 'createdAt', order: 'desc' }],
      },
    }),
    placeholderData: keepPreviousData,
  });
  const items = files.data?.items ?? [];
  const total = files.data?.pagination.total ?? 0;

  return (
    <div className="flex flex-col gap-3" data-testid="file-image-source">
      <Select
        options={[
          {
            value: ROOT_FOLDER,
            label: t('file.folder.root'),
            children: folderOptions(folders, undefined),
          },
        ]}
        selectableGroups
        searchable
        value={folderId}
        onValueChange={(value) => {
          setFolderId(value);
          setLimit(PAGE_SIZE);
        }}
        defaultExpandedValues={[ROOT_FOLDER]}
        aria-label={t('file.imageSource.folder')}
        searchPlaceholder={t('file.move.search')}
        data-testid="file-image-source-folder"
      />
      {files.isPending ? (
        <Skeleton width="100%" height={160} />
      ) : items.length === 0 ? (
        <Empty title={t('file.imageSource.empty')} description={t('file.imageSource.emptyHint')} />
      ) : (
        <ul className="m-0 grid max-h-96 list-none grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3 overflow-auto p-0">
          {items.map((file) => {
            const reason = unusableReason(file, usage);
            const label = reason
              ? t('file.imageSource.tooSmall', {
                  name: file.name,
                  width: usage.minWidth,
                  height: usage.minHeight,
                })
              : file.name;
            const thumbnail = file.image?.thumbnailUrl ?? file.thumbnailUrl;
            return (
              <li key={file.id}>
                <button
                  type="button"
                  disabled={reason !== undefined}
                  title={label}
                  aria-label={label}
                  className="flex w-full cursor-pointer flex-col gap-1 border-0 bg-transparent p-0 text-left disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() =>
                    onSelect({
                      kind: 'source',
                      source: FILE_IMAGE_SOURCE_ID,
                      refId: file.id,
                      name: file.name,
                      // 裁切用全螢幕預覽（縮小版），比例以原圖的尺寸換算
                      preview: file.image
                        ? {
                            src: file.image.previewUrl,
                            width: file.image.width,
                            height: file.image.height,
                          }
                        : null,
                    })
                  }
                  data-testid="file-image-source-item"
                  data-value={file.id}
                >
                  <span className="block aspect-square w-full overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-fill-subtle)]">
                    {thumbnail && (
                      <img
                        src={thumbnail}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </span>
                  <span className="truncate text-xs">{file.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {items.length < total && (
        <Button
          variant="ghost"
          loading={files.isFetching}
          onClick={() => setLimit((current) => current + PAGE_SIZE)}
        >
          {t('file.imageSource.more')}
        </Button>
      )}
    </div>
  );
}
