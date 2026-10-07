import { create } from '@b2b-system/web-shared/hooks';

interface CommandPaletteStore {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

/** 面板開關：快捷鍵、頂列的搜尋按鈕與面板本身共用。 */
export const useCommandPaletteStore = create<CommandPaletteStore>((set, get) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set({ open: !get().open }),
}));
