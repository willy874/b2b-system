# 三處 data-testid 以字串模板組成

## 現況

[`coding-standards/06-literal-strings.md`](../coding-standards/06-literal-strings.md) 規定 testid 必須是完整字面量（變動的部分放 `data-value`），以下三處違反：

| 位置 | 寫法 | 產生的 testid |
| --- | --- | --- |
| `packages/web-core/src/data-import/ImportPreview.tsx:562` | `` `import-submit-${stat.key}` `` | `import-submit-create`／`-update`／`-unchanged`／`-errors` |
| `packages/web-core/src/data-import/ImportSetup.tsx:161` | `` `import-template-${format}` `` | `import-template-csv`／`-xlsx`… |
| `packages/web-core/src/components/RichTable/TableSettings/TableSettings.tsx:272` | `` `table-settings-pin-${side}` `` | `table-settings-pin-left`／`-right` |

E2E 已經依賴第一個（`apps/e2e/tests/data-transfer.spec.ts` 的 `import-submit-errors`）。lint 沒有攔到模板組成的 testid。

## 影響

搜尋原始碼找不到完整的 testid；改名時 E2E 會在執行期才壞。

## 修正方式

改成固定的 testid ＋ `data-value`（例：`data-testid="import-submit-stat" data-value={stat.key}`，筆數另放 `data-count`），
同一批更新 E2E 的選擇器；可考慮在 lint 加一條規則擋 `data-testid={`…${}…`}`。

## 驗證方式

`grep -rn 'data-testid={`' apps/*/src packages/*/src` 沒有結果；`data-transfer.spec.ts` 照常通過。
