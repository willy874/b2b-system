import type { AppPluginFactory } from '@b2b-system/web-core/app';
import { sessionStore } from '@b2b-system/web-core/auth';
import { getActiveBatchQueue } from '@b2b-system/web-core/batch';
import type { BatchPort } from '@b2b-system/web-core/batch';
import { MAIN_BACKEND } from '@b2b-system/web-core/client';
import { afterEach, describe, expect, it } from 'vitest';

import { batchQueuePlugin } from '../batch-queue';

/** 記下分頁送給佇列的指令（不起 worker，也沒有佇列在另一端）。 */
function recordingPort() {
  const sent: Array<{ type: string }> = [];
  const port: BatchPort = {
    postMessage: (message) => sent.push(message as { type: string }),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  return { port, sent, types: () => sent.map((message) => message.type) };
}

/** 建立並初始化 plugin；回傳 onDestroy。 */
function installPlugin(port: BatchPort) {
  const results = batchQueuePlugin({
    backend: MAIN_BACKEND,
    connect: () => ({ mode: 'inline', port, ownsHost: true }),
  })({} as Parameters<AppPluginFactory>[0]);
  void results.onInit?.();
  return () => results.onDestroy?.();
}

let destroy: (() => void) | undefined;

afterEach(() => {
  destroy?.();
  destroy = undefined;
  sessionStore.clear();
});

describe('batchQueuePlugin（docs/architecture/frontend/07-ui-system.md §13.2 D12）', () => {
  it('主 session 結束 → 送出 reset 清空佇列（不只取消進行中的工作）', () => {
    const { port, types } = recordingPort();
    destroy = installPlugin(port);
    sessionStore.setTokens({ accessToken: 'token', expiresIn: 300 });

    sessionStore.endSession('logout');

    expect(types()).toContain('reset');
    expect(types()).not.toContain('cancel-all');
  });

  it('送出的工作帶著目前登入的身分（租戶＋使用者）：佇列面板據此過濾', () => {
    const { port, sent } = recordingPort();
    destroy = installPlugin(port);
    // 身分取自 access token 的 tid 與 sub（只解碼，不驗簽）
    const claims = btoa(JSON.stringify({ sub: 'user-1', tid: 'tenant-1' }));
    sessionStore.setTokens({ accessToken: `header.${claims}.signature`, expiresIn: 300 });

    getActiveBatchQueue()?.enqueue({ operation: 'op', scope: 'list', items: [] });

    expect(sent).toContainEqual(
      expect.objectContaining({ type: 'enqueue', principal: 'tenant-1:user-1' }),
    );
  });
});
