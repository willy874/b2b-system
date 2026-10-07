import type { AppPluginFactory } from '../../app';
import { queryClient } from '../../cache';
import { captureError, initTelemetry, isExpectedError } from '../../telemetry';
import type { TelemetryOptions } from '../../telemetry';

/**
 * 前端錯誤回報（docs/architecture/frontend/19-observability.md）：註冊在 app context 的 **最前面**，
 * 在同步階段就初始化 SDK，啟動過程中的錯誤也收得到。
 *
 * - 全域的未捕捉例外與 Promise rejection：SDK 的整合
 * - React 的錯誤（含路由頁面）：app 把 `telemetryRootOptions()` 交給 `createRoot`
 * - query／mutation 的非預期錯誤：這裡訂閱快取（`AppError`、網路、中止由 UI 處理，後端也有紀錄，不上報）
 * - 頁面的 path 樣板：router 建立後由 app 呼叫 `bindTelemetryRouter(context.router)`
 */
export function telemetryPlugin(options: TelemetryOptions): AppPluginFactory {
  return () => {
    initTelemetry(options);
    let offQueries: (() => void) | undefined;
    let offMutations: (() => void) | undefined;
    return {
      name: 'telemetry',
      onInit: () => {
        // 只看「這次變成錯誤」：observer 增減也會發事件，而 state.error 仍在（同 GlobalProvider 的 403 處理）
        offQueries = queryClient.getQueryCache().subscribe((event) => {
          if (event.type !== 'updated' || event.action.type !== 'error') return;
          if (!isExpectedError(event.action.error)) captureError(event.action.error, 'query');
        });
        offMutations = queryClient.getMutationCache().subscribe((event) => {
          if (event.type !== 'updated' || event.action.type !== 'error') return;
          if (!isExpectedError(event.action.error)) captureError(event.action.error, 'mutation');
        });
      },
      onDestroy: () => {
        offQueries?.();
        offMutations?.();
      },
    };
  };
}
