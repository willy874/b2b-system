import { registerHotkey } from '../hotkey';
import { registerHeaderTool } from '../toolbar';
import { CommandPaletteTrigger } from './CommandPaletteTrigger';
import { COMMAND_PALETTE_HOTKEY } from './constants';
import { useCommandPaletteStore } from './store';

/**
 * app 在 plugin 的同步階段呼叫一次：登記 ⌘K 與頂列的搜尋按鈕。面板本身由 `DashboardShell` 渲染。
 * 輸入框裡也能按 ⌘K（搜尋框、表單裡想跳頁是常見的情境），再按一次關閉。
 */
export function registerCommandPalette(): void {
  registerHotkey({
    combo: COMMAND_PALETTE_HOTKEY,
    allowInInput: true,
    run: () => useCommandPaletteStore.getState().toggle(),
  });
  registerHeaderTool({
    key: 'commandPalette',
    order: 50,
    labelI18nKey: 'commandPalette.toolLabel',
    icon: 'search',
    Component: CommandPaletteTrigger,
  });
}
