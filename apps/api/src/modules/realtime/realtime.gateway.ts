import type { IncomingMessage } from 'node:http';

import {
  ChannelEnvelopeWireSchema,
  ClientEvent,
  isRelayableChannel,
  MAX_RELAY_ENVELOPE_BYTES,
  ServerEvent,
} from '@b2b-system/realtime';
import type { RealtimeConnectErrorData, SessionRenewResult } from '@b2b-system/realtime';
import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';
import { z } from 'zod';

import { AccessTokenVerifier } from '@/common/auth';
import { Authenticated } from '@/common/decorators';
import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';
import type { ErrorCode } from '@/core/errors';
import { requestHost } from '@/core/http';
import { ShutdownState } from '@/core/lifecycle';
import { realtimeConnections, realtimeHandshakeRejected } from '@/core/metrics';
import { RateLimitStore } from '@/core/rate-limit';
import { requireTenant, runInTenantContext, Tenancy, TenantDirectory } from '@/core/tenant';
import type { TenantContext } from '@/core/tenant';

import { RealtimeAudience } from './realtime.audience';
import {
  REALTIME_DRAIN_BATCHES,
  REALTIME_DRAIN_SPREAD,
  REALTIME_LIMITS,
  REALTIME_MAX_FRAME_BYTES,
} from './realtime.constants';
import type { RealtimeLimits } from './realtime.constants';
import { RealtimeExpiry } from './realtime.expiry';
import { SocketIoRealtimePublisher } from './realtime.publisher';
import { clientIpOf, FixedWindowCounter } from './realtime.rate-limit';
import type { TrustProxyFn } from './realtime.rate-limit';
import {
  idpSessionRoom,
  PLATFORM_ROOM,
  platformAdminRoom,
  tenantRoom,
  userRoom,
} from './realtime.rooms';
import type { RealtimeServer, RealtimeSocket } from './realtime.types';

const SessionRenewSchema = z.object({ token: z.string().min(1).max(4096) });

/** handshake 被拒：客戶端在 `connect_error` 的 `err.data.code` 拿到，與 HTTP 的錯誤碼同一套。 */
function connectError(code: ErrorCode): Error {
  return Object.assign(new Error(code), { data: { code } satisfies RealtimeConnectErrorData });
}

/**
 * 連線的入口（docs/architecture/backend/08-realtime.md §3、§8、§11）。與 `RealtimePublisher` 的
 * Socket.io 實作一起構成傳輸層；listener 與 audience 不直接碰這裡的 `server`。
 *
 * - 連線：`allowRequest`（Origin ＋ 每 IP handshake 次數）→ `io.use` 以網域決定租戶、驗 access token → 加入 room。
 * - 租戶：handshake 的網域決定這條連線屬於哪個租戶，之後這條連線上的每則訊息都在該租戶的脈絡裡處理
 *   （docs/architecture/05-tenancy.md §10.2 D2、D3）。apps/platform 的網域不屬於任何租戶：那裡的連線是平台管理者的，
 *   沒有租戶脈絡、只加入平台的 room（§3.6）。
 * - 訊息：`WsAuthGuard` 重驗使用者 → `PermissionsGuard` 看宣告；每個處理器都要有授權宣告
 *   （`common/route-audit.ts`）。
 * - 兩個守門員都是全域的 `APP_GUARD`（app.module.ts；Nest 12 起全域 guard／interceptor 也套用到 gateway），
 *   不在這裡 `@UseGuards`：class 層的 guard 排在全域之後，`PermissionsGuard` 會先於 `WsAuthGuard` 執行。
 *   HTTP 專用的全域 guard（`RateLimitGuard`、`JwtAuthGuard`、`FeatureGuard`）與 `TransformInterceptor`
 *   遇到 ws 直接放行；速率限制在本檔自己做（§11）。全域 filter 仍不套用到 gateway。
 */
@WebSocketGateway({
  path: '/socket.io', // 瀏覽器看到的是 /api/socket.io；proxy 去掉 /api（同 HTTP）
  transports: ['websocket'], // 不開 long-polling：免 sticky session，也少一條吃 cookie 的 HTTP 路徑
  serveClient: false,
  cors: false, // 同源；另以 allowRequest 檢查 Origin
  maxHttpBufferSize: REALTIME_MAX_FRAME_BYTES,
})
export class RealtimeGateway
  implements OnGatewayInit<RealtimeServer>, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server?: RealtimeServer;

  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly allowMissingOrigin: boolean;
  /** 每條連線的訊息數：連線不會換節點，計在本機即可（handshake 的每 IP 次數經 `RateLimitStore`，可跨節點共享）。 */
  private readonly messages: FixedWindowCounter;
  /** 連線 → 它的租戶脈絡（handshake 時決定，連線期間不變）。 */
  private readonly tenants = new WeakMap<RealtimeSocket, TenantContext>();
  /** apps/platform 網域上平台管理者的連線（§3.6）：沒有租戶脈絡。 */
  private readonly platform = new WeakSet<RealtimeSocket>();
  /** apps/platform 的網域（`PLATFORM_APP_URL` 的 host）：同 `TenantMiddleware` 判定平台的方式。 */
  private readonly authHost: string;

  constructor(
    private readonly verifier: AccessTokenVerifier,
    private readonly audience: RealtimeAudience,
    private readonly expiry: RealtimeExpiry,
    config: ConfigService<Env, true>,
    @Inject(REALTIME_LIMITS) private readonly limits: RealtimeLimits,
    private readonly adapterHost: HttpAdapterHost,
    private readonly publisher: SocketIoRealtimePublisher,
    private readonly directory: TenantDirectory,
    private readonly tenancy: Tenancy,
    private readonly rateLimits: RateLimitStore,
    private readonly shutdown: ShutdownState,
  ) {
    this.allowedOrigins = new Set(config.get('REALTIME_ALLOWED_ORIGINS', { infer: true }));
    this.authHost = new URL(config.get('PLATFORM_APP_URL', { infer: true })).host.toLowerCase();
    // 瀏覽器一定帶 Origin；沒帶的只會是 Node 客戶端（整合測試、腳本），production 一律拒絕
    this.allowMissingOrigin = config.get('NODE_ENV', { infer: true }) !== 'production';
    this.messages = new FixedWindowCounter(limits.messageWindowMs);
  }

  afterInit(io: RealtimeServer): void {
    this.publisher.attach(io);
    this.shutdown.onDrain((drainMs) => this.drainConnections(io, drainMs));
    realtimeConnections.observe(this, (report) => report({}, io.engine.clientsCount));
    io.engine.opts.allowRequest = (req, callback) => {
      void this.checkRequest(req).then((rejection) => {
        if (rejection) {
          realtimeHandshakeRejected.inc({ code: rejection });
          this.logger.warn(
            { ip: clientIpOf(req, this.trustProxy()), code: rejection },
            'WebSocket handshake 被拒',
          );
          callback(rejection, false);
          return;
        }
        callback(null, true);
      });
    };

    // 驗證失敗就不建立連線，不會有「先連上再踢掉」的空窗
    io.use((socket, next) => {
      this.enterTenant(io, socket).then(
        (code) => {
          if (!code) return next();
          realtimeHandshakeRejected.inc({ code });
          this.logger.warn({ ip: socket.handshake.address, code }, 'WebSocket handshake 驗證失敗');
          next(connectError(code));
        },
        (error: unknown) => {
          this.logger.error({ err: error }, 'WebSocket handshake 驗證發生錯誤');
          next(connectError('INTERNAL_ERROR'));
        },
      );
    });
  }

  async handleConnection(socket: RealtimeSocket): Promise<void> {
    if (this.platform.has(socket)) {
      await this.onConnected(socket);
      return;
    }
    const tenant = this.tenants.get(socket);
    if (!tenant) {
      socket.disconnect(true);
      return;
    }
    // 之後這條連線上的每則訊息都在同一個租戶裡處理；socket.io 在 middleware 鏈之後以 nextTick 分派，
    // AsyncLocalStorage 會跟著傳過去
    socket.use((_packet, next) => runInTenantContext(tenant, () => next()));
    await runInTenantContext(tenant, () => this.onConnected(socket));
  }

  private async onConnected(socket: RealtimeSocket): Promise<void> {
    const { userId } = socket.data;
    socket.data.connectedAt = Date.now();
    this.limitMessages(socket);
    this.expiry.schedule(socket);
    socket.once('disconnect', (reason) => {
      this.logger.log(
        { socketId: socket.id, userId, reason, durationMs: Date.now() - socket.data.connectedAt },
        'WebSocket 斷線',
      );
    });

    try {
      // 先解析完權限再一次加入所有 room：看得到這條連線在 user room 裡，就代表 perm room 也已就緒
      // （解析權限可能要查 DB，分開加入時會有一段「在 user room、還不在 perm room」的空窗）
      const scopeRooms = this.platform.has(socket)
        ? [PLATFORM_ROOM]
        : [tenantRoom(requireTenant().id), ...(await this.audience.roomsFor(userId))];
      await socket.join([
        this.ownRoom(socket),
        ...(socket.data.idpSessionUid ? [idpSessionRoom(socket.data.idpSessionUid)] : []),
        ...scopeRooms,
      ]);
    } catch (error) {
      this.logger.error({ err: error, socketId: socket.id, userId }, '加入 room 失敗，斷線');
      socket.disconnect(true);
      return;
    }
    this.logger.log({ socketId: socket.id, userId }, 'WebSocket 連線');
  }

  handleDisconnect(socket: RealtimeSocket): void {
    this.expiry.cancel(socket);
    this.messages.forget(socket.id);
  }

  /**
   * 客戶端的 token 續期後送來新 token：同一個 verifier 驗證、`sub` 必須相同（不能在連線上換人），
   * 通過就把授權期限延到新 token 的 `exp`（§3.4）。
   */
  @Authenticated()
  @SubscribeMessage(ClientEvent.SESSION_RENEW)
  async renew(
    @ConnectedSocket() socket: RealtimeSocket,
    @MessageBody() body: unknown,
  ): Promise<SessionRenewResult> {
    const parsed = SessionRenewSchema.safeParse(body);
    const result = await this.verifier.verify(parsed.success ? parsed.data.token : undefined);
    if (!result.ok) return { ok: false, code: result.code };
    if (result.user.id !== socket.data.userId) {
      this.logger.warn(
        { socketId: socket.id, userId: socket.data.userId },
        'session.renew 換人被拒',
      );
      return { ok: false, code: 'AUTH_TOKEN_INVALID' satisfies ErrorCode };
    }

    socket.data.tokenVersion = result.payload.ver;
    socket.data.expiresAt = result.payload.exp * 1000;
    this.expiry.schedule(socket);
    return { ok: true };
  }

  /** 跨裝置中繼：只轉給同一個使用者的其他連線；白名單頻道；外框 ≤ 4 KB（§8）。 */
  @Authenticated()
  @SubscribeMessage(ClientEvent.CHANNEL_RELAY)
  relay(@ConnectedSocket() socket: RealtimeSocket, @MessageBody() body: unknown): void {
    const envelope = ChannelEnvelopeWireSchema.safeParse(body);
    if (!envelope.success || !isRelayableChannel(envelope.data.channel)) return;
    if (Buffer.byteLength(JSON.stringify(envelope.data)) > MAX_RELAY_ENVELOPE_BYTES) return;
    socket.to(this.ownRoom(socket)).emit(ServerEvent.CHANNEL_RELAY, envelope.data);
  }

  // ── 內部 ─────────────────────────────────────────────────

  /** 同一個人的所有連線：租戶的使用者（帶租戶）或平台管理者。 */
  private ownRoom(socket: RealtimeSocket): string {
    return this.platform.has(socket)
      ? platformAdminRoom(socket.data.userId)
      : userRoom(socket.data.userId);
  }

  /**
   * `main.ts` 設定的 `trust proxy` 由 Express 編譯成判定函式；每次讀取而不在建構時快取，
   * 因為 `app.set()` 發生在 DI 初始化之後。沒有 Express（或沒設定）時一律不信任代理。
   */
  private trustProxy(): TrustProxyFn {
    const instance: unknown = this.adapterHost.httpAdapter?.getInstance();
    const fn =
      instance && typeof (instance as { get?: unknown }).get === 'function'
        ? (instance as { get(name: string): unknown }).get('trust proxy fn')
        : undefined;
    return typeof fn === 'function' ? (fn as TrustProxyFn) : () => false;
  }

  /**
   * 排空：把本節點的連線分批關掉底層的傳輸（不是 `socket.disconnect()`——那是「伺服器要你走」，客戶端不會自動重連），
   * 客戶端照一般的斷線退避重連，readiness 已經是 503，會連到其他節點。排空期是 0 時不分批，交給關閉流程。
   */
  private drainConnections(io: RealtimeServer, drainMs: number): void {
    const sockets = [...io.sockets.sockets.values()];
    if (drainMs <= 0 || sockets.length === 0) return;
    const batches = Math.min(sockets.length, REALTIME_DRAIN_BATCHES);
    const size = Math.ceil(sockets.length / batches);
    const intervalMs = (drainMs * REALTIME_DRAIN_SPREAD) / batches;
    this.logger.log({ connections: sockets.length, batches }, '排空：分批關閉 WebSocket 連線');
    for (let index = 0; index < batches; index += 1) {
      const batch = sockets.slice(index * size, (index + 1) * size);
      setTimeout(() => {
        for (const socket of batch) socket.conn.close();
      }, index * intervalMs).unref();
    }
  }

  /** HTTP 升級前的檢查：排空中、Origin 白名單、每個 IP 的 handshake 次數。回傳拒絕原因。 */
  private async checkRequest(req: IncomingMessage): Promise<string | undefined> {
    // 排空中不收新連線：LB 移除之前還送過來的，讓客戶端重試到其他節點
    if (this.shutdown.draining) return 'SERVICE_NOT_READY' satisfies ErrorCode;
    if (await this.isHandshakeLimited(clientIpOf(req, this.trustProxy()))) {
      return 'RATE_LIMITED' satisfies ErrorCode;
    }
    const origin = req.headers.origin;
    const allowed = origin
      ? this.allowedOrigins.has(origin) || this.isSameOrigin(origin, req)
      : this.allowMissingOrigin;
    return allowed ? undefined : 'ORIGIN_NOT_ALLOWED';
  }

  /**
   * 每個 IP 的 handshake 次數（`REALTIME_HANDSHAKES_PER_IP`）。計數存不了時放行：這是防濫用，不是授權，
   * 不能因為計數的儲存出問題就讓所有人連不上推播（docs/features/multi-instance.md D6）。
   */
  private async isHandshakeLimited(ip: string): Promise<boolean> {
    try {
      const record = await this.rateLimits.hit(
        `realtimeHandshake:${ip}`,
        this.limits.handshakeWindowMs,
      );
      return record.count > this.limits.handshakesPerIp;
    } catch (error) {
      this.logger.error({ err: error }, 'WebSocket handshake 的計數失敗，放行');
      return false;
    }
  }

  /**
   * 頁面與連線同源：每個租戶的 backstage 在自己的網域，連的是同網域的 `/api/socket.io`
   * （docs/architecture/05-tenancy.md §10.2 D2），不必把每個租戶的網域都列進 `REALTIME_ALLOWED_ORIGINS`。
   * 跨站 WebSocket 劫持的頁面在別的網域，Origin 的 host 一定對不上。
   */
  private isSameOrigin(origin: string, req: IncomingMessage): boolean {
    if (!URL.canParse(origin)) return false;
    const host = requestHost(req.headers, req.socket.remoteAddress, this.trustProxy());
    return Boolean(host) && new URL(origin).host.toLowerCase() === host;
  }

  /** 以 handshake 的網域決定租戶，在該租戶裡驗 token；回傳拒絕的錯誤碼。 */
  private async enterTenant(
    io: RealtimeServer,
    socket: RealtimeSocket,
  ): Promise<ErrorCode | undefined> {
    const req = socket.request;
    const host = requestHost(req.headers, req.socket.remoteAddress, this.trustProxy());
    // apps/platform 的網域：平台管理者的連線，沒有租戶脈絡；verifier 在這裡只接受平台的 token
    if (host === this.authHost) {
      this.platform.add(socket);
      return this.authenticate(io, socket);
    }
    const record = host ? await this.directory.resolveHost(host) : undefined;
    if (!record) return 'TENANT_NOT_FOUND';
    let tenant: TenantContext;
    try {
      tenant = await this.tenancy.enter(record);
    } catch (error) {
      if (error instanceof AppException) return error.code;
      throw error;
    }
    this.tenants.set(socket, tenant);
    return runInTenantContext(tenant, () => this.authenticate(io, socket));
  }

  /** 驗 token 並把身分寫進 `socket.data`；回傳拒絕的錯誤碼。 */
  private async authenticate(
    io: RealtimeServer,
    socket: RealtimeSocket,
  ): Promise<ErrorCode | undefined> {
    // 只從 handshake.auth 取；query string 會進 proxy 與存取日誌
    const token: unknown = socket.handshake.auth?.token;
    const result = await this.verifier.verify(typeof token === 'string' ? token : undefined);
    if (!result.ok) return result.code;

    // 單一執行個體：本機 adapter 的 room 大小就是該使用者的連線數
    const own = this.platform.has(socket)
      ? platformAdminRoom(result.user.id)
      : userRoom(result.user.id);
    const open = io.sockets.adapter.rooms.get(own)?.size ?? 0;
    if (open >= this.limits.connectionsPerUser) return 'RATE_LIMITED';

    Object.assign(socket.data, {
      userId: result.user.id,
      email: result.user.email,
      tokenVersion: result.payload.ver,
      expiresAt: result.payload.exp * 1000,
      idpSessionUid: result.payload.sid,
      connectedAt: Date.now(),
    });
    return undefined;
  }

  /** 每條連線的訊息速率：超過上限略過，超過兩倍視為濫用並斷線（§11）。 */
  private limitMessages(socket: RealtimeSocket): void {
    socket.use((_packet, next) => {
      const count = this.messages.hit(socket.id);
      if (count <= this.limits.messagesPerSocket) {
        next();
        return;
      }
      if (count > this.limits.messagesPerSocket * 2) {
        this.logger.warn({ socketId: socket.id, userId: socket.data.userId }, '訊息速率過高，斷線');
        socket.disconnect(true);
      }
      // 不呼叫 next：略過這則訊息（呼叫 next(err) 會在沒有 error listener 時印出堆疊）
    });
  }
}
