/*
 * 首次繪製前套用主題，避免深色使用者先看到一閃白畫面。
 * 獨立成同源檔案而不是內嵌在 index.html：正式環境的 CSP（deploy/nginx.conf）不允許 inline script。
 * 鍵與值域對應 packages/web-core/src/store/preference.ts 的 THEME_KEY（dictStorage 以 JSON 存值）與
 * packages/web-shared/src/constants/theme.ts；之後的切換由 packages/web-core/src/plugins/app/theme.ts 接手。
 * 讀取失敗（私密瀏覽、值損壞）一律退回「跟隨系統」。
 */
(function () {
  var preference = 'system';
  try {
    var stored = JSON.parse(localStorage.getItem('b2b-system:preference:theme'));
    if (stored === 'light' || stored === 'dark') preference = stored;
  } catch {
    // 忽略：退回跟隨系統
  }
  var dark =
    preference === 'dark' ||
    (preference === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
