import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppPluginFactory } from '../../../app';
import { queryClient } from '../../../cache';
import { AppError } from '../../../errors';
import { captureError, initTelemetry } from '../../../telemetry';
import type { TelemetryOptions } from '../../../telemetry';
import type * as Telemetry from '../../../telemetry';
import { telemetryPlugin } from '../telemetry';

vi.mock('../../../telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof Telemetry>()),
  initTelemetry: vi.fn(),
  captureError: vi.fn(),
}));

const OPTIONS: TelemetryOptions = { app: 'backstage', release: 'r1', environment: 'test' };

/** 建立並初始化 plugin；回傳 onDestroy。 */
function installPlugin() {
  const plugin = telemetryPlugin(OPTIONS)({} as Parameters<AppPluginFactory>[0]);
  void plugin.onInit?.();
  return { plugin, destroy: () => plugin.onDestroy?.() };
}

async function failQuery(key: string, error: unknown) {
  await queryClient
    .fetchQuery({
      queryKey: ['telemetry-test', key],
      queryFn: () => Promise.reject(error),
      retry: false,
    })
    .catch(() => undefined);
}

async function failMutation(error: unknown) {
  await queryClient
    .getMutationCache()
    .build(queryClient, { mutationFn: () => Promise.reject(error), retry: false })
    .execute(undefined)
    .catch(() => undefined);
}

let destroy: (() => void) | undefined;

afterEach(() => {
  destroy?.();
  destroy = undefined;
  queryClient.clear();
  vi.clearAllMocks();
});

describe('telemetryPlugin（docs/architecture/frontend/19-observability.md）', () => {
  it('建立時（同步階段）就初始化 SDK，名稱是 telemetry', () => {
    const installed = installPlugin();
    destroy = installed.destroy;

    expect(installed.plugin.name).toBe('telemetry');
    expect(initTelemetry).toHaveBeenCalledWith(OPTIONS);
  });

  it('query 的非預期錯誤上報，來源是 query', async () => {
    destroy = installPlugin().destroy;
    const error = new TypeError('x is not a function');

    await failQuery('bug', error);

    expect(captureError).toHaveBeenCalledWith(error, 'query');
  });

  it('mutation 的非預期錯誤上報，來源是 mutation', async () => {
    destroy = installPlugin().destroy;
    const error = new TypeError('boom');

    await failMutation(error);

    expect(captureError).toHaveBeenCalledWith(error, 'mutation');
  });

  it('AppError（UI 處理、後端有紀錄）不上報', async () => {
    destroy = installPlugin().destroy;

    await failQuery('app-error', new AppError('ROLE_NOT_FOUND', 404));
    await failMutation(new AppError('ROLE_NOT_FOUND', 404));

    expect(captureError).not.toHaveBeenCalled();
  });

  it('成功的 query 不上報', async () => {
    destroy = installPlugin().destroy;

    await queryClient.fetchQuery({ queryKey: ['telemetry-test', 'ok'], queryFn: () => 1 });

    expect(captureError).not.toHaveBeenCalled();
  });

  it('onDestroy 之後不再訂閱快取', async () => {
    installPlugin().destroy();

    await failQuery('after-destroy', new TypeError('late'));
    await failMutation(new TypeError('late'));

    expect(captureError).not.toHaveBeenCalled();
  });
});
