# 刪除外部 IdP 連線失敗時對話框仍被關掉

## 現況

`apps/backstage/src/features/identity-provider/pages/IdentityProviderList/page.tsx` 第 179–191 行：

```tsx
onConfirm={async () => {
  if (!removing) return;
  await remove.mutateAsync({ params: { id: removing.id } }).catch(showError);
  setRemoving(undefined);
}}
```

`.catch(showError)` 吞掉錯誤後照樣執行 `setRemoving(undefined)`，失敗時對話框也關掉。其他 feature（`tag/pages/TagList/page.tsx` 第 165–171 行、`webhook/pages/WebhookList/page.tsx` 第 93–99 行）都是失敗時 `return`、對話框留著讓使用者重試或取消。

另外兩點：

- 這個 `AlertDialog` 沒有 `tone="danger"`，其他刪除確認都有。
- 確認文字（`locales/zh_TW.json` 的 `identityProvider.remove.confirm`）已說明「網域會被釋出、已連結的使用者不能再以它登入」，但沒提到設為 `sso_only` 的網域（`docs/architecture/04-sso.md` 的 `identity_provider_domains`）會一起失去「只能用 SSO」的限制。

## 影響

刪除失敗（權限被收回、網路錯誤）時 toast 一閃而過、對話框消失，使用者容易以為已刪除；與其他列表頁的行為不一致。

嚴重度低：不會刪錯資料，只是失敗回饋與一致性。

## 修正方式

- 照 tag／webhook 的寫法：`try { await remove.mutateAsync(…) } catch (error) { showError(error); return; }` 之後才關閉。
- 加 `tone="danger"`。
- 選擇性：確認文字補一句 SSO-only 網域會恢復成可用密碼登入（兩個語系檔一起改）。

## 驗證方式

- 頁面測試補：刪除的請求回 500 時對話框仍開著、顯示錯誤；成功時關閉。

（2026-10-10 backstage 各功能的優化分析發現。）
