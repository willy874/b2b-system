import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { RenderOptions, RenderResult } from '@testing-library/react';
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { ConfirmDialogHost } from '@/app/ConfirmDialogHost';
import { ToastHost } from '@/app/ToastHost';
import { TooltipProvider } from '@/components/Tooltip';
import { AppContextProvider, createAppContext } from '@/core/app';
import type { PermissionKey } from '@/core/permission';
import { usePermissionStore, useWorkspaceStore } from '@/core/store';
import { eventBusPlugin } from '@/plugins/app';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

/** 元件樹用得到的最小 AppContext：`useToast()` 需要 eventBus。 */
export function createTestAppContext() {
  return createAppContext().use(eventBusPlugin());
}

export function AllProviders({ children }: { children: ReactNode }) {
  const [context] = useState(createTestAppContext);
  const [client] = useState(createTestQueryClient);
  return (
    <AppContextProvider context={context}>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <ToastHost>
            <ConfirmDialogHost>{children}</ConfirmDialogHost>
          </ToastHost>
        </TooltipProvider>
      </QueryClientProvider>
    </AppContextProvider>
  );
}

/** 測試用的目前工作區：工作區頁面的元件都在它底下渲染（docs/adr/0018-workspace-tenancy.md D17）。 */
export const TEST_WORKSPACE = {
  id: '99999999-9999-4999-8999-999999999999',
  slug: 'test',
  name: '測試工作區',
} as const;

/** `permissions` 是 `can()` 看到的集合（平台 ∪ 目前工作區），兩層都視為已水合。 */
export function renderWithPermissions(
  ui: ReactElement,
  permissions: PermissionKey[] = [],
  options?: RenderOptions,
): RenderResult {
  usePermissionStore.setState({
    permissions: new Set(permissions),
    hydrated: true,
    workspaceHydrated: true,
  });
  useWorkspaceStore.setState({ current: { ...TEST_WORKSPACE } });
  return render(ui, { wrapper: AllProviders, ...options });
}

/** 權限尚未水合的情境（第三態）。 */
export function renderUnhydrated(ui: ReactElement, options?: RenderOptions): RenderResult {
  usePermissionStore.setState({
    permissions: new Set(),
    hydrated: false,
    workspaceHydrated: false,
  });
  useWorkspaceStore.setState({ current: { ...TEST_WORKSPACE } });
  return render(ui, { wrapper: AllProviders, ...options });
}
