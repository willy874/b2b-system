import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocaleStore } from '@/core/store';
import { Languages } from '@/shared/constants/lang';

import { LanguageMenu } from '../LanguageMenu';

const changeLocale = vi.fn();
vi.mock('@/features/account', () => ({ useChangeLocale: () => changeLocale }));

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe('LanguageMenu（頂列的語言切換）', () => {
  beforeEach(() => {
    changeLocale.mockReset();
    useLocaleStore.setState({ locale: Languages.ZH_TW });
  });

  it('只有兩種語言時是一顆按鈕，顯示目前語言，按一下切到另一種', async () => {
    const user = userEvent.setup();
    render(<LanguageMenu />, { wrapper });

    const toggle = screen.getByTestId('language-toggle');
    expect(toggle).toHaveTextContent('繁體中文');
    expect(screen.queryByTestId('language-menu-trigger')).not.toBeInTheDocument();

    await user.click(toggle);
    expect(changeLocale).toHaveBeenCalledWith(Languages.EN_US);
  });
});
