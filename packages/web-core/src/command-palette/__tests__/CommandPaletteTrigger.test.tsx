import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '../../testing/i18n';
import { AllProviders } from '../../testing/renderWithPermissions';
import { CommandPaletteTrigger } from '../CommandPaletteTrigger';
import { useCommandPaletteStore } from '../store';

beforeAll(() => initTestI18n());

beforeEach(() => {
  useCommandPaletteStore.setState({ open: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubPlatform(platform: string) {
  vi.stubGlobal('navigator', { ...navigator, platform, userAgentData: undefined });
}

describe('CommandPaletteTrigger（頂列的搜尋按鈕）', () => {
  it('點了打開命令面板', () => {
    render(<CommandPaletteTrigger />, { wrapper: AllProviders });

    fireEvent.click(screen.getByTestId('command-palette-trigger'));

    expect(useCommandPaletteStore.getState().open).toBe(true);
  });

  it('名稱帶出 Windows／Linux 的快捷鍵', () => {
    stubPlatform('Win32');
    render(<CommandPaletteTrigger />, { wrapper: AllProviders });

    const trigger = screen.getByTestId('command-palette-trigger');
    expect(trigger).toHaveAccessibleName('搜尋（Ctrl+K）');
    expect(trigger).toHaveAttribute('title', '搜尋（Ctrl+K）');
  });

  it('Mac 上顯示 ⌘K', () => {
    stubPlatform('MacIntel');
    render(<CommandPaletteTrigger />, { wrapper: AllProviders });

    expect(screen.getByTestId('command-palette-trigger')).toHaveAccessibleName('搜尋（⌘K）');
  });
});
