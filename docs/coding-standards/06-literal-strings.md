# 06 — 識別字串必須是完整字面量

適用：**i18n key**、**className**、**`data-testid`**；route id 有更嚴格的版本（§3.4）。

---

## 1. 規則

> 這三種字串 **不得用字串模板（`` `a-${b}` ``）或 `+` 串接組成**。
> 每一個會出現在執行期的值，都必須以 **完整的字面量** 出現在原始碼的某一處。

| 對象          | ❌ 不可以                                           | ✅ 改成                                                        |
| ------------- | --------------------------------------------------- | -------------------------------------------------------------- |
| i18n key      | ``t(`user.status.${status}`)``                      | `t(USER_STATUS_LABEL_KEY[status])`（對照表，見 §3.1）           |
| className     | ``cn('ge-shell', `ge-shell--${state}`)``            | `cn('ge-shell', SHELL_STATE_CLASS[state])`（見 §3.2）           |
| `data-testid` | ``data-testid={`role-permission-node-${key}`}``      | `data-testid="role-permission-node" data-value={key}`（見 §3.3） |

強度：👀 Review（尚無 lint 規則；補上後改成 🔒）。

---

## 2. 為什麼

三種字串都是 **跨檔案、跨工具的連結點**，連結的另一端只會用「完整字串」去找：

| 對象          | 另一端                                   | 組字串的後果                                                                 |
| ------------- | ---------------------------------------- | ---------------------------------------------------------------------------- |
| i18n key      | `locales/*.json`、未使用 key 檢查        | 在語系檔看到 `user.status.locked`，全專案搜不到是誰在用；刪 key 不敢刪、漏翻譯不會被發現 |
| className     | UnoCSS 靜態擷取、CSS 檔                  | UnoCSS 掃不到組出來的 utility class，**正式建置時樣式直接消失**；CSS 的 modifier 搜不到呼叫端 |
| `data-testid` | E2E / 單元測試的選擇器                   | E2E 寫 `role-permission-node-user:read`，在原始碼搜不到；改名時測試靜默壞掉       |

共通原則：**從任何一端搜尋完整字串，都要能找到另一端。**

---

## 3. 寫法

### 3.1 i18n key

值域有限（enum、狀態）→ 用 `as const` 對照表，key 以完整字面量寫在表裡：

```ts
// features/user/constants.ts
export const USER_STATUS_LABEL_KEY = {
  pending: 'user.status.pending',
  active: 'user.status.active',
  inactive: 'user.status.inactive',
  locked: 'user.status.locked',
} as const satisfies Record<UserStatus, string>;
```

```tsx
<span>{t(USER_STATUS_LABEL_KEY[user.status])}</span>
```

`satisfies Record<UserStatus, string>` 讓後端新增狀態時編譯失敗，而不是畫面上出現原始 key。

其他允許的來源：

| 來源                              | 例                                                  | 條件                                          |
| --------------------------------- | --------------------------------------------------- | --------------------------------------------- |
| 設定物件中的完整字面量            | `{ labelKey: 'menu.role', … }` → `t(item.labelKey)` | 欄位名以 `Key` / `I18nKey` 結尾               |
| 後端回傳的完整 key                | `t(permission.nameI18nKey)`                         | 後端以字面量存放（`db/seeds/permissions.ts`） |

錯誤碼同理：`packages/web-core/src/errors/errorMessageKey.ts` 的 `ERROR_MESSAGE_KEY` 對照表，而不是 `` `error.${code}` ``。
新增錯誤碼時要加進這張表（🔒 型別檢查與 web-core 的 `resources.test.ts` 會比對它與後端錯誤碼清單）。

### 3.2 className

設計系統元件（`@b2b-system/ui`）用 CSS Module，class 來自 `styles.xxx`，變體不組 class 而是寫成 `data-*` 屬性
（見 [`architecture/frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §3.3、§3.4）：

```tsx
import styles from './Button.module.css';

<button className={cn(styles.root, className)} data-variant={variant} data-block={block || undefined} />
```

`features/`、`app/` 用 UnoCSS 工具類或全域 class 時，variant、size 這類有限值域 → 對照表：

```ts
const TONE_CLASS = {
  default: 'text-fg',
  muted: 'text-muted',
} as const satisfies Record<Tone, string>;

className={cn('text-sm', TONE_CLASS[tone], bold && 'font-semibold', className)}
```

- 條件 class 用 `cn()` 的 `條件 && '完整字串'`，不用三元運算組字串片段。
- 真正連續的值（寬度、位置、顏色計算結果）不是 class 的工作 → 用 `style` 或 CSS 變數：
  ``style={{ '--ge-progress': `${percent}%` }}``（這裡的模板組的是 **值**，不是 class，允許）。
- `key` prop 不在本規則範圍內，可以用模板。

### 3.3 `data-testid`

**固定部分放 `data-testid`，變動部分放另一個 `data-*` 屬性：**

```tsx
<button data-testid="role-permission-node" data-value={key} />
```

```ts
// E2E
getByTestIdAndValue(page, 'role-permission-node', 'user:read');
// 等同 page.locator('[data-testid="role-permission-node"][data-value="user:read"]')
```

- 值域固定的一組元素（選單、分頁），在設定物件裡寫完整字面量：
  `{ to: '/role', labelKey: 'menu.role', testId: 'menu-role' }`。
- 設計系統元件（`@b2b-system/ui`）渲染的列表項目統一用 `<元件>-item` ＋ `data-value`，
  例如 `data-testid="menu-item" data-value="logout"`。
- E2E 用 `apps/e2e/helpers/selectors.ts` 的 `getByTestIdAndValue(page, 'role-permission-node', 'user:read')`。

### 3.4 route id（`<RouteLink to>`、`useRouteLinkAccess()`）

比前三種更嚴格：**呼叫處直接寫字面量**，連對照表也不用——
🔒 `app/__tests__/route-links.test.ts` 掃原始碼比對已登記的 id，只認得呼叫處的字面量。

| ❌ 不可以 | ✅ 改成 |
| --- | --- |
| ``<RouteLink to={`${type}.detail`}>`` | 依 `type` 分支，各寫 `<RouteLink to="user.detail">`、`<RouteLink to="group.detail">` |
| `<RouteLink to={TARGET_ID}>` | `<RouteLink to="user.detail">` |

見 [`architecture/frontend/03-feature-anatomy.md`](../architecture/frontend/03-feature-anatomy.md) §4.1。

---

## 4. 檢查方式

提交前搜尋（應該沒有結果，或每筆都屬於 §3 的允許情況）：

```bash
# i18n key：t(`…${…}`)、`xxx.${…}` 形式的 key
git grep -nE '\bt\(`|`[a-z][A-Za-z_-]*\.[A-Za-z_.]*\$\{' -- 'apps/backstage/src/*.ts' 'apps/backstage/src/*.tsx' ':!*.test.*'
# className：`ge-xxx--${…}` 形式的 modifier
git grep -nE '`[a-z][a-z0-9-]*--\$\{' -- 'apps/backstage/src/*.tsx'
# data-testid
git grep -nE 'data-testid=\{`' -- apps/backstage/src
```
