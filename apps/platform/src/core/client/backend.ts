/**
 * 主後端：它的 session 決定整個 app 的登入狀態（登入頁、權限、profile）。
 * 其他後端各自獨立登入，session 結束只影響自己的請求。
 */
export const MAIN_BACKEND = 'main';

export interface BackendContextNames {
  /** 不帶身分：登入、續期、公開端點 */
  base: string;
  /** 帶該後端 session 的 access token，401 時續期重放 */
  auth: string;
}

/** 每個後端有兩個 `HttpContext`，名稱由後端名稱推導，兩邊（plugin 與 fetcher）不必各寫一次。 */
export function backendContextNames(backend: string): BackendContextNames {
  return { base: `${backend}:base`, auth: `${backend}:auth` };
}
