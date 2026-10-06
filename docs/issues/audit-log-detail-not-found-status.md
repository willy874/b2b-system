# 稽核明細查無資料時回 400 `VALIDATION_FAILED`，不是 404

## 現況

`apps/api/src/modules/audit-log/audit-log.service.ts` 的 `findOne()`（L45–55）：

- id 不是整數（`BigInt()` 丟錯）：`400 VALIDATION_FAILED`，`fields.id = 'must be a numeric id'`。
- 查不到：同樣回 `400 VALIDATION_FAILED`，`fields.id = 'not found'`。
- 空字串：`BigInt('')` 是 `0n`，不會被當成格式錯誤，最後走到「查不到」。

其他模組查無資料都回 `404 <RESOURCE>_NOT_FOUND`（`USER_NOT_FOUND`、`JOB_NOT_FOUND`、`API_TOKEN_NOT_FOUND`…）。
`packages/error-codes` 沒有 `AUDIT_LOG_NOT_FOUND`。
[`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §7 有 `GET /audit-logs/:id`，但沒有規定查無資料時回什麼。

## 影響

- 前端照錯誤碼顯示訊息，會把「這筆紀錄不存在」顯示成「輸入不正確」。
- 對外的契約不一致：其他資源查不到都是 404，只有稽核是 400。
- 目前只有 backstage 的稽核頁展開明細時打這支 API，id 都來自列表，所以實際上很少遇到。

## 修正方式

1. 新增錯誤碼 `AUDIT_LOG_NOT_FOUND`（404）。依 CLAUDE.md「錯誤碼變更」：改 `packages/error-codes`、`packages/web-core` 的 `ERROR_MESSAGE_KEY` 和兩個語系檔的 `error.AUDIT_LOG_NOT_FOUND`。
2. `findOne()` 查不到時改拋 `AUDIT_LOG_NOT_FOUND`。格式錯誤可以維持 `VALIDATION_FAILED`，也可以一起改成 404，因為字串 id 本來就不可能存在。
3. 空字串和非整數一樣當成格式錯誤，例如先用 `/^\d+$/` 檢查。
4. 在 06-audit-log.md §7 補上錯誤回應，然後重新產生 openapi 和 SDK。

## 驗證方式

`audit-log.service.spec.ts` 的 `findOne` 測試改成斷言新的錯誤碼。`pnpm typecheck` 會確認兩個語系檔都有新的 key。
