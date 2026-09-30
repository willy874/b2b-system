import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { AUTH_PROFILE_QUERY_KEY } from '@/apis/auth/get-profile/query';
import { TooltipProvider } from '@/components/Tooltip';
import { AppContextProvider } from '@/core/app';
import type { AppContext } from '@/core/app';
import { queryClient } from '@/core/cache';
import { AppError, ErrorCodes } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';

import { ComponentLabelsHost } from './ComponentLabelsHost';
import { ConfirmDialogHost } from './ConfirmDialogHost';
import { ToastHost } from './ToastHost';

/** 同一波失敗（例如一個頁面上好幾個 query 同時 403）只提示、重抓一次。 */
const DRIFT_DEBOUNCE_MS = 2_000;

function isForbidden(error: unknown): boolean {
  return error instanceof AppError && error.code === ErrorCodes.AUTHZ_FORBIDDEN;
}

/**
 * 收到 AUTHZ_FORBIDDEN 代表「UI 顯示的能力」與「後端實際授權」不一致——
 * 通常是權限剛被改掉。後端是權威，UI 發現不一致就立刻自我修正。
 *
 * 只看「這次變成錯誤」的事件（`action.type === 'error'`）：cache 在 observer 增減、
 * 重新訂閱時也會發事件，而 `state.error` 仍留著，只看它會重複提示。
 */
function PermissionDriftWatcher() {
  const toast = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    let lastHandledAt = 0;
    const onError = (error: unknown) => {
      if (!isForbidden(error)) return;
      const now = Date.now();
      if (now - lastHandledAt < DRIFT_DEBOUNCE_MS) return;
      lastHandledAt = now;
      toast.warning(t('error.permission_changed'));
      void queryClient.invalidateQueries({ queryKey: [AUTH_PROFILE_QUERY_KEY] });
    };

    const offMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') onError(event.action.error);
    });
    const offQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error') onError(event.action.error);
    });
    return () => {
      offMutations();
      offQueries();
    };
  }, [t, toast]);

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
        <ComponentLabelsHost>
          <TooltipProvider>
            <ToastHost>
              <ConfirmDialogHost>
                <PermissionDriftWatcher />
                {children}
              </ConfirmDialogHost>
            </ToastHost>
          </TooltipProvider>
        </ComponentLabelsHost>
      </QueryClientProvider>
    </AppContextProvider>
  );
}
