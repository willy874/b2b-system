import { Injectable, Logger } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Socket } from 'socket.io';

import { AccessTokenVerifier } from '../auth/access-token.verifier';
import { getSocketIdentity } from '../types';

/**
 * WebSocket 訊息處理器的守門員：每則客戶端訊息都以 `socket.data` 重驗使用者
 * （走 `UserCacheService`，30 秒 TTL）。停用、刪除、`token_version` 不符或授權期限已過
 * → 拒絕並斷線（docs/architecture/backend/08-realtime.md §4）。
 *
 * 以 `@UseGuards(WsAuthGuard, PermissionsGuard)` 掛在 gateway 上（全域 Guard 不作用在 gateway），
 * 讓「先認人、再看權限」的順序與 HTTP 相同；非 ws 的執行環境直接放行。
 */
@Injectable()
export class WsAuthGuard implements CanActivate {
  private readonly logger = new Logger(WsAuthGuard.name);

  constructor(private readonly verifier: AccessTokenVerifier) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'ws') return true;

    const socket = ctx.switchToWs().getClient<Socket>();
    const identity = getSocketIdentity(socket);
    const code = !identity
      ? 'AUTH_TOKEN_INVALID'
      : identity.expiresAt <= Date.now()
        ? 'AUTH_TOKEN_INVALID'
        : await this.verifier
            .checkUser(identity.userId, identity.tokenVersion)
            .then((result) => (result.ok ? undefined : result.code));

    if (!code) return true;

    this.logger.log(
      { socketId: socket.id, userId: identity?.userId, code },
      'ws 訊息驗證失敗，斷線',
    );
    socket.disconnect(true);
    return false;
  }
}
