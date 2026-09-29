import { useWorkspaceStore } from '@/core/store/workspace';
import type { CurrentWorkspace } from '@/core/store/workspace';

export type { CurrentWorkspace };

/** 目前所在的工作區；不在工作區頁面時是 null。 */
export function useCurrentWorkspace(): CurrentWorkspace | null {
  return useWorkspaceStore((state) => state.current);
}

/**
 * 工作區頁面裡的元件用：一定在工作區版面底下渲染（版面解析完 slug 才渲染子頁面），
 * 拿不到就是被放錯了地方。
 */
export function useRequiredWorkspace(): CurrentWorkspace {
  const current = useCurrentWorkspace();
  if (!current) {
    throw new Error('useRequiredWorkspace() 只能在工作區版面（/w/:workspaceSlug）底下使用');
  }
  return current;
}
