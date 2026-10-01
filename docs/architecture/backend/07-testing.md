# 後端 07 — 測試

## 1. 三層

| 層                        | 工具                                  | 資料庫           | 數量級 |
| ------------------------- | ------------------------------------- | ---------------- | ------ |
| 單元（service 業務規則）  | Vitest ＋ 假 repository               | ❌               | 多     |
| 整合（repository + 查詢） | Vitest ＋ Testcontainers              | ✅ 真實 Postgres | 中     |
| E2E（HTTP → DB）          | Vitest ＋ supertest ＋ Testcontainers | ✅               | 中     |

**不用 sqlite 或 mock DB 做整合測試。** 本專案大量依賴 Postgres 特有的能力
（`citext`、partial unique index、`CHECK`、trigger、`json_agg`），
在別的引擎上測到的東西不代表正式環境的行為。

---

## 2. Testcontainers 設定

```ts
// test/setup-db.ts
import { PostgreSqlContainer } from "@testcontainers/postgresql";

let container: StartedPostgreSqlContainer;
export let testDb: Database;

export async function setupTestDatabase() {
  // 實際的做法見 test/global-setup.ts：平台 DB 是 container 的預設 database，
  // 另建一個測試租戶的 database 並登記在平台 DB（網域 127.0.0.1／localhost）
  // image 必填（Testcontainers 11 起模組不再有預設 image），與 docker-compose.yml 用同一個
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  process.env.PLATFORM_DATABASE_URL = container.getConnectionUri();
  testDb = createDb(container.getConnectionUri());
  await migrate(testDb, { migrationsFolder: "src/db/migrations" });
  await seedPermissions(testDb);
  await seedRoles(testDb);
}

export async function truncateAll() {
  // 保留 permissions 與 roles（seed 資料），只清業務資料
  await testDb.execute(sql`
    TRUNCATE users, relation_tuples, refresh_tokens, auth_tokens, audit_logs
    RESTART IDENTITY CASCADE
  `);
}
```

一個容器供整個測試檔案共用（`beforeAll` 啟動），每個 `it` 之間
`truncateAll()`。啟動一次容器約 3 秒，每次 truncate 約 5 ms。

**`relation_tuples` 一定要清**：角色的持有者、權限鍵、資料夾授權都存在這張表（[`02-database.md`](./02-database.md) §2.10），
而 `users` 被清掉時沒有外鍵會 cascade 到它；殘留的邊會讓下一個測試的權限判斷出錯。

---

## 3. 單元測試：Service 業務規則

這一層測「規則是否正確」，不碰資料庫。

```ts
describe("RoleService.updatePermissions", () => {
  it("super-admin 角色不可變更權限", async () => {
    roleRepo.findById.mockResolvedValue({ id: "r1", slug: "super-admin", isSystem: true });
    await expect(
      service.updatePermissions("r1", { add: ["user:read"], remove: [] }, actor),
    ).rejects.toMatchObject({ code: "ROLE_SUPER_ADMIN_IMMUTABLE" });
  });

  it("授予自己沒有的權限會被拒絕（反提權）", async () => {
    roleRepo.findById.mockResolvedValue({ id: "r1", slug: "editor", isSystem: false });
    permissionService.getPermissionSet.mockResolvedValue({
      permissions: new Set(["role:read", "role:grantPermission"]),
      isSuperAdmin: false,
    });
    await expect(
      service.updatePermissions("r1", { add: ["user:delete"], remove: [] }, actor),
    ).rejects.toMatchObject({ code: "AUTHZ_ESCALATION", details: { missing: ["user:delete"] } });
  });

  it("super-admin 執行時跳過反提權檢查", async () => {
    permissionService.getPermissionSet.mockResolvedValue({
      permissions: new Set(),
      isSuperAdmin: true,
    });
    await expect(
      service.updatePermissions("r1", { add: ["user:delete"], remove: [] }, superActor),
    ).resolves.toBeDefined();
  });

  it("快取失效發生在交易提交之後", async () => {
    const order: string[] = [];
    db.transaction.mockImplementation(async (fn) => {
      await fn(tx);
      order.push("commit");
    });
    permissionService.permissionsChanged.mockImplementation(async () => {
      order.push("invalidate");
    });
    await service.updatePermissions("r1", { add: [], remove: ["user:read"] }, actor);
    expect(order).toEqual(["commit", "invalidate"]);
  });
});
```

最後一個測試值得特別寫：交易前失效是一個很容易犯、而且很難用手工測出來的錯。

---

## 4. 整合測試：Repository 與 DB 約束

```ts
describe("關係圖的 revision（test/authz-revision.spec.ts）", () => {
  it("relation_tuples 的每一條寫入語句讓 revision +1；一條語句寫多列只 +1", async () => {
    const start = await revision();
    await db.insert(relationTuples).values([
      rolePermissionTuple(readerRoleId, "role:read"),
      rolePermissionTuple(readerRoleId, "auditLog:read"),
    ]);
    expect(await revision()).toBe(start + 1); // migration 0009 的 statement-level trigger
  });
});
```

trigger、約束這類只有資料庫才驗證得到的規則，寫成整合測試。

關係圖的規則（等級、繼承、擁有者規則、依賴樹閉包）以純記憶體的 tuple 在單元測試驗證
（`core/authz/__tests__`、`modules/file/__tests__/file.authz.spec.ts`、`file-grant.levels.spec.ts`），不需要資料庫。

快取失效（[`05-rbac.md`](./05-rbac.md) §5.1）：`test/authz-revision.spec.ts` 以真 Postgres 驗證 `authz_revision` 的 trigger 語意、
平台 DB 上真的廣播、另一個程序（第二個 Nest app）收到後失效；`core/authz/__tests__/authz.revision.spec.ts` 測「只處理較新的 revision」與重連；
`core/cache/__tests__/permission-cache.service.spec.ts` 測整個租戶失效與取票。

```ts
```

### 4.1 DB 約束也要測

```ts
describe("資料庫不變條件", () => {
  it("I3：軟刪除後同名角色可再建立", async () => {
    const r = await createRole({ name: "編輯" });
    await softDeleteRole(r.id);
    await expect(createRole({ name: "編輯" })).resolves.toBeDefined();
  });

  it("I7：trigger 阻擋刪除系統角色（繞過 service 也不行）", async () => {
    await expect(testDb.delete(roles).where(eq(roles.slug, "admin"))).rejects.toThrow(
      /ROLE_SYSTEM_PROTECTED/,
    );
  });

  it("I12：audit_logs 不可 UPDATE", async () => {
    const [log] = await testDb.insert(auditLogs).values(sampleLog).returning();
    await expect(
      testDb.update(auditLogs).set({ action: "tampered" }).where(eq(auditLogs.id, log.id)),
    ).rejects.toThrow(/AUDIT_LOG_IMMUTABLE/);
  });

  it("I2：permissions.key 必須等於 resource:action", async () => {
    await expect(
      testDb.insert(permissions).values({
        key: "wrong",
        resource: "user",
        action: "read",
        nameI18nKey: "x",
      }),
    ).rejects.toThrow(/permissions_key_format/);
  });
});
```

這些測試證明「即使有人繞過 service 直接改資料庫，不變條件仍然成立」。

---

## 5. E2E：完整 HTTP 路徑

```ts
describe("RBAC end-to-end", () => {
  let app: INestApplication;

  it("admin 可以建立角色並指派，被指派者取得對應權限", async () => {
    const admin = await loginAs("admin");

    const { body: role } = await request(app.getHttpServer())
      .post("/roles")
      .set(admin.auth)
      .send({ name: "內容檢視", permissionKeys: ["user:read"] })
      .expect(201);

    const target = await createUser({ status: "active" });
    await request(app.getHttpServer())
      .put(`/users/${target.id}/roles`)
      .set(admin.auth)
      .send({ roleIds: [role.data.id] })
      .expect(200);

    const targetSession = await loginAs(target.email);
    const { body: profile } = await request(app.getHttpServer())
      .get("/auth/profile")
      .set(targetSession.auth)
      .expect(200);

    expect(profile.data.permissions).toContain("user:read");
    await request(app.getHttpServer()).get("/users").set(targetSession.auth).expect(200);
    await request(app.getHttpServer())
      .post("/users")
      .set(targetSession.auth)
      .send({ email: "x@y.z", displayName: "X" })
      .expect(403);
  });

  it("移除角色權限後，持有者的下一次請求立即被拒", async () => {
    const admin = await loginAs("admin");
    const { role, user, session } = await setupUserWithRole(["user:read"]);

    await request(app.getHttpServer()).get("/users").set(session.auth).expect(200);

    await request(app.getHttpServer())
      .patch(`/roles/${role.id}/permissions`)
      .set(admin.auth)
      .send({ add: [], remove: ["user:read"] })
      .expect(200);

    // ★ 不等 TTL——主動失效必須立即生效
    await request(app.getHttpServer()).get("/users").set(session.auth).expect(403);
  });

  it("反提權：admin 不能授予自己沒有的權限", async () => {
    const admin = await loginAs("admin"); // 沒有 system:update
    const { body } = await request(app.getHttpServer())
      .post("/roles")
      .set(admin.auth)
      .send({ name: "提權測試", permissionKeys: ["system:update"] })
      .expect(403);
    expect(body.error.code).toBe("AUTHZ_ESCALATION");
    expect(body.error.details.missing).toEqual(["system:update"]);
  });

  it("停用使用者後，其既有 access token 立即失效", async () => {
    const admin = await loginAs("admin");
    const { user, session } = await setupUserWithRole(["user:read"]);
    await request(app.getHttpServer()).get("/users").set(session.auth).expect(200);

    await request(app.getHttpServer())
      .patch(`/users/${user.id}`)
      .set(admin.auth)
      .send({ status: "inactive" })
      .expect(200);

    const { body } = await request(app.getHttpServer()).get("/users").set(session.auth).expect(401);
    expect(body.error.code).toBe("AUTH_TOKEN_STALE");
  });

  it("refresh token 重用 → 整條家族被撤銷", async () => {
    const s = await loginAs("admin");
    const r1 = await refresh(s.refreshToken); // 正常輪替
    await refresh(s.refreshToken).expect(401); // 重用舊的 → 偵測
    await refresh(r1.refreshToken).expect(401); // 新的也一起失效
  });

  it("每一個路由都宣告了授權策略", () => {
    expect(() => auditRoutes(app)).not.toThrow();
  });
});
```

---

## 6. 測試輔助

```ts
// test/helpers/auth.ts
export async function loginAs(emailOrSlug: string) {
  const email = SEED_ACCOUNTS[emailOrSlug] ?? emailOrSlug;
  const res = await request(app.getHttpServer())
    .post("/auth/login")
    .send({ email, password: TEST_PASSWORD })
    .expect(200);
  return {
    accessToken: res.body.data.accessToken,
    refreshToken: extractCookie(res, "refresh_token"),
    auth: { Authorization: `Bearer ${res.body.data.accessToken}` },
  };
}

// test/helpers/fixtures.ts
export async function createRole(input: { name: string; permissions?: string[] }) {
  /* 直接寫 DB */
}
export async function createUser(input?: Partial<NewUser>) {
  /* 直接寫 DB */
}
export async function assignRoles(userId: string, roleIds: string[]) {
  /* 直接寫 DB */
}
```

Fixture **直接寫資料庫**，不經 API——測試的前置條件不應該依賴被測的 API 正確。

---

## 7. 覆蓋率目標

| 範圍                                     | 目標      |
| ---------------------------------------- | --------- |
| `common/guards/**`                       | **100%**  |
| `modules/auth/**`                        | **≥ 95%** |
| `modules/credential/**`                  | **≥ 95%** |
| `modules/permission/**`                  | **≥ 95%** |
| `core/cache/permission-cache.service.ts` | **100%**  |
| `modules/role/role.service.ts`           | ≥ 90%     |
| `modules/user/user.service.ts`           | ≥ 90%     |
| `core/errors/**`                         | ≥ 85%     |
| 整體                                     | ≥ 80%     |

---

## 8. 必測清單

**Guard**

- [ ] `@Public` 路由不需要 token
- [ ] `@Authenticated` 路由需要 token 但不需要權限
- [ ] 未宣告的路由 → `ROUTE_PERMISSION_NOT_DECLARED`
- [ ] `match: 'every'` / `match: 'some'` 的判定正確
- [ ] super-admin 繞過所有權限檢查
- [ ] 403 時寫入 `authz.denied` 稽核，含 `missing`

**權限快取**

- [ ] TTL 到期後重新解析
- [ ] `invalidate(userId)` 立即生效
- [ ] 角色權限、持有者變更、刪除角色時，交易提交後呼叫 `permissionsChanged()`（順序測試）
- [ ] `invalidateTenant` 清掉那個租戶的所有人、不動其他租戶；取票後被整個租戶失效的載入結果不寫回
- [ ] 其他程序的較新 revision 讓本機失效；舊的或自己送的略過；監聽連線重連時整個快取丟棄
- [ ] 快取值是 `Set`，不是陣列

**反提權**

- [ ] 授予自己沒有的權限 → `AUTHZ_ESCALATION`
- [ ] 指派帶有自己沒有的權限的角色 → `AUTHZ_ESCALATION`
- [ ] 非 super-admin 指派 super-admin 角色 → `AUTHZ_ESCALATION`（`details.role`），即使持有全部權限鍵（[`05-rbac.md`](./05-rbac.md) §4.1）
- [ ] super-admin 豁免
- [ ] 空陣列不觸發檢查

**業務規則**

- [ ] 系統角色不可刪除 / 改 slug（service ＋ trigger 兩層）
- [ ] super-admin 角色權限不可變更
- [ ] 角色使用中不可刪除，`force=true` 可以
- [ ] 不能停用 / 刪除 / 改角色給自己
- [ ] 不能移除最後一個 super-admin（含「全部停用但不刪除」的情況）

**認證**

- [ ] 帳號不存在與密碼錯誤的回應相同（含耗時在同一量級）
- [ ] 連續失敗達上限 → 鎖定
- [ ] 忘記密碼永遠回 200
- [ ] refresh token 輪替
- [ ] refresh token 重用 → 整條家族撤銷
- [ ] 變更密碼 → 所有 session 失效
- [ ] 停用使用者 → `AUTH_TOKEN_STALE` ＋ refresh token 撤銷
- [ ] `/auth/refresh` 缺少 `x-refresh-request` 標頭 → 拒絕

**稽核**

- [ ] 業務變更與稽核在同一交易（rollback 時兩者都不存在）
- [ ] 稽核寫入失敗 → 整個操作失敗
- [ ] `changes` 不含 `passwordHash`
- [ ] `audit_logs` 無法 UPDATE / DELETE

**契約**

- [ ] 所有路由都有授權宣告
- [ ] 所有 `@RequirePermissions` 用到的鍵都存在於權限目錄
- [ ] `openapi.json` 與原始碼一致（重新產生後無 diff）
- [ ] 每個 `ErrorCode` 在前端兩個語系檔中都有對應翻譯
