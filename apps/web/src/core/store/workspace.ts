import { create } from '@/shared/hooks';

/** 目前所在的工作區（由網址的 `/w/:workspaceSlug` 解析而來，docs/adr/0018-workspace-tenancy.md D17）。 */
export interface CurrentWorkspace {
  id: string;
  slug: string;
  name: string;
}

interface WorkspaceStore {
  /** 不在工作區頁面（或還在解析 slug）時是 null。 */
  current: CurrentWorkspace | null;
  setCurrent: (workspace: CurrentWorkspace) => void;
  clear: () => void;
}

/**
 * 目前工作區不是另外保存的狀態：來源是網址，這裡只是讓 `apis/`、`core/` 同步讀得到解析結果。
 * 工作區的版面（`features/workspace`）在解析 slug 之後寫入、離開時清掉。
 */
export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  current: null,
  setCurrent: (workspace) => set({ current: workspace }),
  clear: () => set({ current: null }),
}));
