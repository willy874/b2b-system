import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { RenderOptions, RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import { ToastProvider } from '@/components/Toast';
import { TooltipProvider } from '@/components/Tooltip';
import type { PermissionKey } from '@/core/permission';
import { usePermissionStore } from '@/core/store';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

export function AllProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <TooltipProvider>
        <ToastProvider>{children}</ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>
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
