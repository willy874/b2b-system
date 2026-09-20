import { createDictStorage } from '@/shared/storage';
import { create } from '@/shared/store';

const storage = createDictStorage('layout');
const SIDEBAR_KEY = 'sidebarCollapsed';

interface LayoutStore {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useLayoutStore = create<LayoutStore>((set, get) => ({
  sidebarCollapsed: storage.get(SIDEBAR_KEY, false),
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    storage.set(SIDEBAR_KEY, next);
    set({ sidebarCollapsed: next });
  },
  setSidebarCollapsed: (collapsed) => {
    storage.set(SIDEBAR_KEY, collapsed);
    set({ sidebarCollapsed: collapsed });
  },
}));
