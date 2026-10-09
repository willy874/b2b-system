import { IconButton } from '@b2b-system/ui/Button';
import { Empty } from '@b2b-system/ui/Empty';
import { Icon } from '@b2b-system/ui/Icon';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { useErrorToast } from '@b2b-system/web-core/errors';
import { SignedImage } from '@b2b-system/web-core/image';
import { isLargeEnough } from '@b2b-system/web-core/image-picker';
import type { ImageSourceProps } from '@b2b-system/web-core/image-picker';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  getRecentImagesQueryOptions,
  RECENT_IMAGE_LIST_QUERY_KEY,
} from '@/apis/image/get-recent-images/query';
import { getHideRecentImageMutationOptions } from '@/apis/image/hide-recent-image/mutation';

/**
 * 來源「最近使用」（docs/architecture/frontend/23-image-picker.md §6）：自己建立過的圖片，同一個內容只列一次。
 * 太小的列出但停用，滑過顯示原因。選了之後由伺服器複製成一筆新的資產，可以重新裁切。
 */
export function RecentImageSource({ usage, onSelect }: ImageSourceProps) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const queryClient = useQueryClient();
  const recent = useQuery(getRecentImagesQueryOptions(usage.id));
  const hide = useMutation({
    ...getHideRecentImageMutationOptions(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [RECENT_IMAGE_LIST_QUERY_KEY] }),
    onError: showError,
  });

  if (recent.isPending) return <Skeleton width="100%" height={160} />;
  const items = recent.data?.items ?? [];
  if (items.length === 0) return <Empty title={t('image.recent.empty')} />;

  return (
    <ul
      className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3 p-0"
      data-testid="image-recent-list"
    >
      {items.map((item) => {
        const { original } = item;
        const usable = !original || isLargeEnough(original, usage);
        const label = usable
          ? item.name
          : t('image.recent.tooSmall', {
              name: item.name,
              width: usage.minWidth,
              height: usage.minHeight,
            });
        return (
          <li
            key={item.id}
            className="relative"
            data-testid="image-recent-item"
            data-value={item.id}
          >
            <button
              type="button"
              disabled={!usable}
              title={label}
              aria-label={label}
              className="block aspect-square w-full cursor-pointer overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-fill-subtle)] p-0 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() =>
                onSelect({
                  kind: 'source',
                  source: 'recent',
                  refId: item.id,
                  name: item.name,
                  preview: original
                    ? { src: original.url, width: original.width, height: original.height }
                    : null,
                })
              }
            >
              {original ? (
                <img
                  src={original.url}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : (
                <SignedImage
                  sources={item.image}
                  variant={Object.keys(usage.presets).at(-1) ?? ''}
                  alt=""
                  className="block h-full w-full [&>img]:h-full [&>img]:w-full [&>img]:object-cover"
                />
              )}
            </button>
            <IconButton
              size="sm"
              className="absolute right-1 top-1"
              aria-label={t('image.recent.remove', { name: item.name })}
              onClick={() => hide.mutate({ params: { id: item.id } })}
              data-testid="image-recent-remove"
              data-value={item.id}
            >
              <Icon name="close" size={14} />
            </IconButton>
          </li>
        );
      })}
    </ul>
  );
}
