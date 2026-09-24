import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { RenderOptions, RenderResult } from '@testing-library/react';
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { ToastHost } from '@/app/ToastHost';
import { TooltipProvider } from '@/components/Tooltip';
import { AppContextProvider, createAppContext } from '@/core/app';
import type { PermissionKey } from '@/core/permission';
import { usePermissionStore } from '@/core/store';
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
          <ToastHost>{children}</ToastHost>
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
