import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { WorkspaceScope } from '@/common/types';
import type { Database, DbOrTx } from '@/core/database';
import { DRIZZLE } from '@/core/database';
import type { WorkspaceInvitationRow } from '@/db/schema';
import {
  roles,
  users,
  workspaceInvitationRoles,
  workspaceInvitations,
  workspaces,
} from '@/db/schema';

import type { RoleSummaryRow } from './workspace.repository';

export interface InvitationListRow {
  id: string;
  email: string;
  createdAt: Date;
  expiresAt: Date;
  inviterId: string | null;
  inviterName: string | null;
  hasAccount: boolean;
  roles: RoleSummaryRow[];
}

/** 以 token 找到的邀請，連同工作區（未刪除）與邀請人。 */
export interface InvitationByTokenRow extends WorkspaceInvitationRow {
  workspace: { id: string; slug: string; name: string };
  inviter: { id: string; email: string; displayName: string; locale: string } | null;
}

/** 還沒接受也沒撤銷（不論是否過期）。 */
const PENDING = and(
  isNull(workspaceInvitations.acceptedAt),
  isNull(workspaceInvitations.revokedAt),
);

const inviters = alias(users, 'inviter');

const ROLE_AGGREGATE = sql<RoleSummaryRow[]>`
  COALESCE(
    json_agg(
      json_build_object('id', ${roles.id}, 'slug', ${roles.slug}, 'name', ${roles.name}, 'isSystem', ${roles.isSystem})
      ORDER BY ${roles.slug}
    ) FILTER (WHERE ${roles.id} IS NOT NULL),
    '[]'
  )`;

/** email 已有帳號（未刪除）：接受時走登入，不建立帳號。 */
const HAS_ACCOUNT = sql<boolean>`EXISTS (
  SELECT 1 FROM ${users} u WHERE u.email = ${workspaceInvitations.email} AND u.deleted_at IS NULL
)`;

@Injectable()
export class WorkspaceInvitationRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** 待接受的邀請（含已過期的：管理員看得到、可以撤銷或重新邀請）。 */
  async listPending(ws: WorkspaceScope, id?: string): Promise<InvitationListRow[]> {
    return this.db
      .select({
        id: workspaceInvitations.id,
        email: workspaceInvitations.email,
        createdAt: workspaceInvitations.createdAt,
        expiresAt: workspaceInvitations.expiresAt,
        inviterId: inviters.id,
        inviterName: inviters.displayName,
        hasAccount: HAS_ACCOUNT,
        roles: ROLE_AGGREGATE,
      })
      .from(workspaceInvitations)
      .leftJoin(
        inviters,
        and(eq(inviters.id, workspaceInvitations.invitedBy), isNull(inviters.deletedAt)),
      )
      .leftJoin(
        workspaceInvitationRoles,
        eq(workspaceInvitationRoles.invitationId, workspaceInvitations.id),
      )
      .leftJoin(roles, and(eq(roles.id, workspaceInvitationRoles.roleId), isNull(roles.deletedAt)))
      .where(
        and(
          eq(workspaceInvitations.workspaceId, ws.workspaceId),
          PENDING,
          id ? eq(workspaceInvitations.id, id) : undefined,
        ),
      )
      .groupBy(workspaceInvitations.id, inviters.id)
      .orderBy(desc(workspaceInvitations.createdAt), desc(workspaceInvitations.id));
  }

  async create(
    ws: WorkspaceScope,
    values: { email: string; expiresAt: Date; invitedBy: string },
    roleIds: readonly string[],
    tx: DbOrTx,
  ): Promise<WorkspaceInvitationRow> {
    const [row] = await tx
      .insert(workspaceInvitations)
      .values({ workspaceId: ws.workspaceId, ...values })
      .returning();
    if (!row) throw new Error('建立邀請失敗');
    if (roleIds.length > 0) {
      await tx
        .insert(workspaceInvitationRoles)
        .values([...new Set(roleIds)].map((roleId) => ({ invitationId: row.id, roleId })));
    }
    return row;
  }

  /** 撤銷待接受的邀請；`id` 不給時撤銷這個 email 的全部（重新邀請前）。回傳被撤銷的列。 */
  async revoke(
    ws: WorkspaceScope,
    target: { id: string } | { email: string },
    revokedBy: string,
    tx: DbOrTx,
  ): Promise<WorkspaceInvitationRow[]> {
    return tx
      .update(workspaceInvitations)
      .set({ revokedAt: new Date(), revokedBy })
      .where(
        and(
          eq(workspaceInvitations.workspaceId, ws.workspaceId),
          PENDING,
          'id' in target
            ? eq(workspaceInvitations.id, target.id)
            : eq(workspaceInvitations.email, target.email),
        ),
      )
      .returning();
  }

  /** 寄信的工作用：邀請、所屬工作區（未刪除）與邀請人。 */
  async findForMail(id: string): Promise<InvitationByTokenRow | undefined> {
    const [row] = await this.selectWithContext().where(eq(workspaceInvitations.id, id)).limit(1);
    return row && toContext(row);
  }

  /** 以 token 原文的雜湊找邀請（不判斷是否可用：由 service 決定）。 */
  async findByTokenHash(tokenHash: string): Promise<InvitationByTokenRow | undefined> {
    const [row] = await this.selectWithContext()
      .where(eq(workspaceInvitations.tokenHash, tokenHash))
      .limit(1);
    return row && toContext(row);
  }

  /** 寄出當下換上新的 token 雜湊，並從現在重新起算有效期限。 */
  async setToken(id: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.db
      .update(workspaceInvitations)
      .set({ tokenHash, expiresAt })
      .where(eq(workspaceInvitations.id, id));
  }

  /** 條件式標記為已接受：同時被接受兩次時只有一個成功。 */
  async markAccepted(id: string, userId: string, tx: DbOrTx): Promise<boolean> {
    const rows = await tx
      .update(workspaceInvitations)
      .set({ acceptedAt: new Date(), acceptedBy: userId })
      .where(and(eq(workspaceInvitations.id, id), PENDING))
      .returning({ id: workspaceInvitations.id });
    return rows.length > 0;
  }

  /** 邀請指定的角色（未刪除）。 */
  async listRoles(invitationId: string, tx?: DbOrTx): Promise<RoleSummaryRow[]> {
    const db = tx ?? this.db;
    return db
      .select({ id: roles.id, slug: roles.slug, name: roles.name, isSystem: roles.isSystem })
      .from(workspaceInvitationRoles)
      .innerJoin(roles, and(eq(roles.id, workspaceInvitationRoles.roleId), isNull(roles.deletedAt)))
      .where(eq(workspaceInvitationRoles.invitationId, invitationId))
      .orderBy(asc(roles.slug));
  }

  /** 角色的 slug（稽核用）。 */
  async findRoleSlugs(roleIds: readonly string[]): Promise<string[]> {
    if (roleIds.length === 0) return [];
    const rows = await this.db
      .select({ slug: roles.slug })
      .from(roles)
      .where(inArray(roles.id, [...roleIds]))
      .orderBy(asc(roles.slug));
    return rows.map((row) => row.slug);
  }

  private selectWithContext() {
    return this.db
      .select({
        invitation: workspaceInvitations,
        workspace: { id: workspaces.id, slug: workspaces.slug, name: workspaces.name },
        inviter: {
          id: inviters.id,
          email: inviters.email,
          displayName: inviters.displayName,
          locale: inviters.locale,
        },
      })
      .from(workspaceInvitations)
      .innerJoin(
        workspaces,
        and(eq(workspaces.id, workspaceInvitations.workspaceId), isNull(workspaces.deletedAt)),
      )
      .leftJoin(
        inviters,
        and(eq(inviters.id, workspaceInvitations.invitedBy), isNull(inviters.deletedAt)),
      )
      .$dynamic();
  }
}

function toContext(row: {
  invitation: WorkspaceInvitationRow;
  workspace: InvitationByTokenRow['workspace'];
  inviter: InvitationByTokenRow['inviter'];
}): InvitationByTokenRow {
  return { ...row.invitation, workspace: row.workspace, inviter: row.inviter };
}
