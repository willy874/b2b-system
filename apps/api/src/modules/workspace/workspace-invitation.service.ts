import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PERMISSION, workspaceScopeOf } from '@/common/types';
import type { AuthUser, WorkspaceScope } from '@/common/types';
import type { Env } from '@/core/config';
import type { Database, DbOrTx, Transaction } from '@/core/database';
import { DRIZZLE, withTransaction } from '@/core/database';
import { AppException, isUniqueViolation } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { JobQueue } from '@/core/jobs';
import { AuditService } from '@/modules/audit-log/audit.service';
import { hashPassword } from '@/modules/auth/password';
import { sha256 } from '@/modules/auth/token-hash';
import { PermissionService } from '@/modules/permission/permission.service';
import { UserService } from '@/modules/user/user.service';

import type {
  AcceptedWorkspaceInvitationDto,
  CreateWorkspaceInvitationDto,
  SignupWorkspaceInvitationDto,
  WorkspaceInvitationDto,
  WorkspaceInvitationListDto,
  WorkspaceInvitationPreviewDto,
} from './dto/workspace.dto';
import {
  WORKSPACE_INVITATION_MAIL_JOB,
  WORKSPACE_INVITATION_TTL_SECONDS,
} from './workspace-invitation.constants';
import type { InvitationByTokenRow, InvitationListRow } from './workspace-invitation.repository';
import { WorkspaceInvitationRepository } from './workspace-invitation.repository';
import { WorkspaceRepository } from './workspace.repository';

function toDto(row: InvitationListRow): WorkspaceInvitationDto {
  return {
    id: row.id,
    email: row.email,
    roles: row.roles,
    invitedBy:
      row.inviterId && row.inviterName ? { id: row.inviterId, displayName: row.inviterName } : null,
    hasAccount: row.hasAccount,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    isExpired: row.expiresAt.getTime() < Date.now(),
  };
}

/**
 * 以 email 邀請成員（docs/adr/0018-workspace-tenancy.md D14）。
 *
 * - 邀請時指定工作區角色，受反提權限制（以邀請人在 **這個工作區** 的權限比對）。
 * - 邀請還沒有帳號的 email，邀請人另外需要平台的 `user:create`：建立平台帳號是平台層級的決定，
 *   不能透過工作區繞過註冊審批。
 * - 收件人持有信中連結就證明擁有該信箱：已有帳號的登入後接受（登入的帳號必須是受邀的 email）；
 *   沒有帳號的設定密碼，直接建立 **已啟用** 的帳號並加入。
 * - 同一個工作區、同一個 email 只有一筆待接受；重新邀請會撤銷舊的（舊信的連結跟著失效）。
 */
@Injectable()
export class WorkspaceInvitationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService<Env, true>,
    private readonly repo: WorkspaceInvitationRepository,
    private readonly workspaces: WorkspaceRepository,
    private readonly users: UserService,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
    private readonly jobs: JobQueue,
  ) {}

  // ── 工作區管理員 ─────────────────────────────────────────

  async list(ws: WorkspaceScope): Promise<WorkspaceInvitationListDto> {
    return { items: (await this.repo.listPending(ws)).map(toDto) };
  }

  async invite(
    ws: WorkspaceScope,
    dto: CreateWorkspaceInvitationDto,
    actor: AuthUser,
  ): Promise<WorkspaceInvitationDto> {
    await this.permissions.assertRoleScope(dto.roleIds, 'workspace');
    await this.permissions.assertWorkspaceRolesAssignable(actor.id, ws.workspaceId, dto.roleIds);

    const account = await this.users.findAccountByEmail(dto.email);
    if (account) {
      if (await this.workspaces.findMember(ws, account.id)) {
        throw new AppException('WORKSPACE_MEMBER_DUPLICATE', { field: 'email', value: dto.email });
      }
    } else {
      const { permissions, isSuperAdmin } = await this.permissions.getPermissionSet(actor.id);
      if (!isSuperAdmin && !permissions.has(PERMISSION.USER_CREATE)) {
        throw new AppException('WORKSPACE_INVITATION_USER_CREATE_REQUIRED', {
          required: [PERMISSION.USER_CREATE],
        });
      }
    }
    // 帳號的 email 是 citext：以帳號上的寫法為準，列表與比對才一致
    const email = account?.email ?? dto.email;
    const roleSlugs = await this.repo.findRoleSlugs(dto.roleIds);

    const created = await this.writeUnique(async (tx) => {
      const replaced = await this.repo.revoke(ws, { email }, actor.id, tx);
      const row = await this.repo.create(
        ws,
        {
          email,
          expiresAt: new Date(Date.now() + WORKSPACE_INVITATION_TTL_SECONDS * 1000),
          invitedBy: actor.id,
        },
        dto.roleIds,
        tx,
      );
      await this.audit.record(
        {
          action: 'workspaceInvitation.create',
          resourceType: 'workspaceInvitation',
          resourceId: row.id,
          resourceName: email,
          changes: { after: { email, roles: roleSlugs, hasAccount: Boolean(account) } },
          metadata: {
            workspaceId: ws.workspaceId,
            ...(replaced.length > 0 && { replaced: replaced.map((item) => item.id) }),
          },
        },
        tx,
      );
      // 與邀請同生共死：建立失敗就不會寄出（docs/architecture/backend/11-mail.md §4）
      await this.jobs.enqueue(WORKSPACE_INVITATION_MAIL_JOB, { invitationId: row.id }, { tx });
      return { row, replaced };
    });

    this.publishChanged(ws, [
      ...created.replaced.map((item) => ({ id: item.id, kind: ChangeKind.DELETE })),
      { id: created.row.id, kind: ChangeKind.CREATE },
    ]);
    return this.getPending(ws, created.row.id);
  }

  /** 撤銷待接受的邀請：信中的連結立刻失效。 */
  async revoke(ws: WorkspaceScope, invitationId: string, actor: AuthUser): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const [revoked] = await this.repo.revoke(ws, { id: invitationId }, actor.id, tx);
      if (!revoked) throw new AppException('WORKSPACE_INVITATION_NOT_FOUND');
      await this.audit.record(
        {
          action: 'workspaceInvitation.revoke',
          resourceType: 'workspaceInvitation',
          resourceId: revoked.id,
          resourceName: revoked.email,
          metadata: { workspaceId: ws.workspaceId },
        },
        tx,
      );
    });
    this.publishChanged(ws, [{ id: invitationId, kind: ChangeKind.DELETE }]);
  }

  // ── 受邀者 ───────────────────────────────────────────────

  /** 接受邀請頁的資訊。token 無效（不對、過期、已接受或撤銷、工作區已刪除）一律回同一個錯誤。 */
  async preview(token: string): Promise<WorkspaceInvitationPreviewDto> {
    const invitation = await this.findUsable(token);
    const account = await this.users.findAccountByEmail(invitation.email);
    return {
      email: invitation.email,
      workspaceName: invitation.workspace.name,
      inviterName: invitation.inviter?.displayName ?? null,
      hasAccount: Boolean(account),
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /** 已有帳號：登入後接受。登入的帳號必須就是受邀的 email，避免轉寄的連結讓別人加入。 */
  async accept(token: string, actor: AuthUser): Promise<AcceptedWorkspaceInvitationDto> {
    const invitation = await this.findUsable(token);
    if (actor.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new AppException('WORKSPACE_INVITATION_EMAIL_MISMATCH');
    }
    const ws = workspaceScopeOf(invitation.workspaceId);
    await withTransaction(this.db, (tx) =>
      this.join(invitation, { id: actor.id, email: actor.email }, tx),
    );
    this.afterJoined(ws, invitation.id, actor.id);
    return this.accepted(invitation);
  }

  /**
   * 還沒有帳號：設定密碼，建立 **已啟用** 的帳號並加入工作區。
   * 帳號沒有任何全域角色；前端接著以 email ＋ 剛設定的密碼登入。
   */
  async signup(dto: SignupWorkspaceInvitationDto): Promise<AcceptedWorkspaceInvitationDto> {
    const invitation = await this.findUsable(dto.token);
    if (await this.users.findAccountByEmail(invitation.email)) {
      throw new AppException('WORKSPACE_INVITATION_ACCOUNT_EXISTS');
    }
    const passwordHash = await hashPassword(dto.password, {
      memoryCost: this.config.get('ARGON2_MEMORY_COST', { infer: true }),
      timeCost: this.config.get('ARGON2_TIME_COST', { infer: true }),
    });
    const ws = workspaceScopeOf(invitation.workspaceId);

    let userId: string;
    try {
      userId = await withTransaction(this.db, async (tx) => {
        const user = await this.users.createAccount(
          {
            email: invitation.email,
            displayName: dto.displayName,
            passwordHash,
            status: 'active',
            roleIds: [],
          },
          // 帳號由邀請人授權建立（D14）；邀請人已被刪除時沒有 createdBy
          invitation.inviter && {
            id: invitation.inviter.id,
            email: invitation.inviter.email,
            status: 'active',
          },
          tx,
          { source: 'workspaceInvitation', invitationId: invitation.id },
        );
        await this.join(invitation, { id: user.id, email: user.email }, tx);
        return user.id;
      });
    } catch (error) {
      // 預檢查與寫入之間，同一個 email 被別人先註冊
      if (isUniqueViolation(error)) throw new AppException('WORKSPACE_INVITATION_ACCOUNT_EXISTS');
      throw error;
    }

    this.users.publishCreated(userId, []);
    this.afterJoined(ws, invitation.id, userId);
    return this.accepted(invitation);
  }

  // ── 內部 ─────────────────────────────────────────────────

  private async getPending(ws: WorkspaceScope, id: string): Promise<WorkspaceInvitationDto> {
    const [row] = await this.repo.listPending(ws, id);
    if (!row) throw new AppException('WORKSPACE_INVITATION_NOT_FOUND');
    return toDto(row);
  }

  private async findUsable(token: string): Promise<InvitationByTokenRow> {
    const invitation = await this.repo.findByTokenHash(sha256(token));
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt.getTime() < Date.now()
    ) {
      throw new AppException('WORKSPACE_INVITATION_INVALID');
    }
    return invitation;
  }

  /**
   * 在呼叫端的交易內：標記已接受、加入成員、加上邀請指定的角色（與既有角色取聯集）、寫稽核。
   * 反提權在邀請時已檢查；之後邀請人權限變了，由撤銷邀請處理。
   */
  private async join(
    invitation: InvitationByTokenRow,
    user: { id: string; email: string },
    tx: DbOrTx,
  ): Promise<void> {
    if (!(await this.repo.markAccepted(invitation.id, user.id, tx))) {
      throw new AppException('WORKSPACE_INVITATION_INVALID');
    }
    const ws = workspaceScopeOf(invitation.workspaceId);
    const roles = await this.repo.listRoles(invitation.id, tx);
    const joined = await this.workspaces.addMember(ws, user.id, invitation.invitedBy, tx);
    await Promise.all(
      roles.map((role) =>
        this.workspaces.addMemberRole(ws, user.id, role.id, invitation.invitedBy, tx),
      ),
    );
    await this.audit.record(
      {
        action: 'workspaceInvitation.accept',
        resourceType: 'workspaceInvitation',
        resourceId: invitation.id,
        resourceName: invitation.email,
        actorId: user.id,
        actorEmail: user.email,
        changes: { after: { userId: user.id, roles: roles.map((role) => role.slug) } },
        metadata: { workspaceId: ws.workspaceId, joined },
      },
      tx,
    );
  }

  /** 成員資格與權限變了：快取失效在交易後，接著發事件（CLAUDE.md 後端規則 6）。 */
  private afterJoined(ws: WorkspaceScope, invitationId: string, userId: string): void {
    this.permissions.invalidateUser(userId);
    // 權限從無到有：訂閱者（例：檔案模組建立個人資料夾）跟著反應
    this.events.publish(DomainEvent.PERMISSIONS_CHANGED, { userIds: [userId] });
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [
        { resource: ChangeSource.WORKSPACE_MEMBER, kind: ChangeKind.CREATE, id: userId },
        { resource: ChangeSource.WORKSPACE_INVITATION, kind: ChangeKind.DELETE, id: invitationId },
      ],
      affectedUserIds: [userId],
      workspaceId: ws.workspaceId,
    });
  }

  private publishChanged(ws: WorkspaceScope, changes: { id: string; kind: ChangeKind }[]): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: changes.map(({ id, kind }) => ({
        resource: ChangeSource.WORKSPACE_INVITATION,
        kind,
        id,
      })),
      workspaceId: ws.workspaceId,
    });
  }

  private accepted(invitation: InvitationByTokenRow): AcceptedWorkspaceInvitationDto {
    return { email: invitation.email, workspace: invitation.workspace };
  }

  /** 待接受的唯一索引：同一個 email 同時被邀請兩次時，後到的回業務錯誤而不是 500。 */
  private async writeUnique<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    try {
      return await withTransaction(this.db, work);
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppException('WORKSPACE_INVITATION_DUPLICATE');
      throw error;
    }
  }
}
