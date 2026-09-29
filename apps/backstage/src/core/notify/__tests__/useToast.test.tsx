import { act, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ToastHost } from '@/app/ToastHost';
import { AppContextProvider, GlobalEvents } from '@/core/app';
import { AllProviders, createTestAppContext } from '@/test/renderWithPermissions';

import { useToast } from '../useToast';

describe('useToast（經由 eventBus 顯示提示）', () => {
  it('發出 TOAST_SHOW 事件，帶上類型、標題與說明', () => {
    const context = createTestAppContext();
    const listener = vi.fn();
    context.eventBus.on(GlobalEvents.TOAST_SHOW, listener);

    const { result } = renderHook(() => useToast(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AppContextProvider context={context}>{children}</AppContextProvider>
      ),
    });
    result.current.error('權限不足', '請聯絡管理員');

    expect(listener).toHaveBeenCalledWith({
      type: 'error',
      title: '權限不足',
      description: '請聯絡管理員',
    });
  });

  it('ToastHost 收到事件後把提示渲染到畫面上', async () => {
    const { result } = renderHook(() => useToast(), { wrapper: AllProviders });
    act(() => result.current.success('角色已建立'));

    const toast = await screen.findByTestId('toast');
    expect(toast).toHaveTextContent('角色已建立');
    expect(toast).toHaveAttribute('data-value', 'success');
  });

  it('React 之外直接 emit 到 eventBus 也會顯示', async () => {
    const context = createTestAppContext();
    render(
      <AppContextProvider context={context}>
        <ToastHost>
          <p>內容</p>
        </ToastHost>
      </AppContextProvider>,
    );
    act(() =>
      context.eventBus.emit(GlobalEvents.TOAST_SHOW, { type: 'warning', title: '連線中斷' }),
    );

    expect(await screen.findByTestId('toast')).toHaveAttribute('data-value', 'warning');
  });
});
