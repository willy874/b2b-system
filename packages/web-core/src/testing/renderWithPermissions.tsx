import { TooltipProvider } from '@b2b-system/ui/Tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { RenderOptions, RenderResult } from '@testing-library/react';
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { AppContextProvider, createAppContext } from '../app';
import type { PermissionKey } from '../permission';
import { eventBusPlugin } from '../plugins/app';
import { ConfirmDialogHost } from '../shell/ConfirmDialogHost';
import { ToastHost } from '../shell/ToastHost';
import { usePermissionStore } from '../store';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

/** 元件樹用得到的最小 AppContext：`useToast()` 需要 eventBus。 */
export function createTestAppContext() {
  return createAppContext().use(eventBusPlugin());
}

export interface AllProvidersProps {
  children: ReactNode;
  /** 測試要直接操作快取時傳入（例：以 `setQueryData` 模擬推播讓資料重抓）；不傳就建一個新的。 */
  queryClient?: QueryClient;
}

export function AllProviders({ children, queryClient }: AllProvidersProps) {
  const [context] = useState(createTestAppContext);
  const [client] = useState(() => queryClient ?? createTestQueryClient());
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

export function renderWithPermissions(
  ui: ReactElement,
  permissions: PermissionKey[] = [],
  options?: RenderOptions,
): RenderResult {
  usePermissionStore.setState({ permissions: new Set(permissions), hydrated: true });
  return render(ui, { wrapper: AllProviders, ...options });
}

/** 權限尚未水合的情境（第三態）。 */
export function renderUnhydrated(ui: ReactElement, options?: RenderOptions): RenderResult {
  usePermissionStore.setState({ permissions: new Set(), hydrated: false });
  return render(ui, { wrapper: AllProviders, ...options });
}
