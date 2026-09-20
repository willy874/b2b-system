import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { AUTH_PROFILE_QUERY_KEY } from '@/apis/auth/get-profile/query';
import { ToastProvider, useToast } from '@/components/Toast';
import { TooltipProvider } from '@/components/Tooltip';
import { AppContextProvider } from '@/core/app';
import type { AppContext } from '@/core/app';
import { queryClient } from '@/core/cache';
import { AppError } from '@/core/errors';
import { useTranslation } from '@/core/locales';

/**
 * 收到 AUTHZ_FORBIDDEN 代表「UI 顯示的能力」與「後端實際授權」不一致——
 * 通常是權限剛被改掉。後端是權威，UI 發現不一致就立刻自我修正。
 */
function PermissionDriftWatcher() {
  const toast = useToast();
  const { t } = useTranslation();

  useEffect(
    () =>
      queryClient.getMutationCache().subscribe((event) => {
        const error = event.mutation?.state.error;
        if (error instanceof AppError && error.code === 'AUTHZ_FORBIDDEN') {
          toast.warning(t('error.permission_changed'));
          void queryClient.invalidateQueries({ queryKey: [AUTH_PROFILE_QUERY_KEY] });
        }
      }),
    [t, toast],
  );

  return null;
}

export function GlobalProvider({
  context,
  children,
}: {
  context: AppContext;
  children: ReactNode;
}) {
  return (
    <AppContextProvider context={context}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ToastProvider>
            <PermissionDriftWatcher />
            {children}
          </ToastProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </AppContextProvider>
  );
}
