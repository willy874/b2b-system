import { AbortReason, NetworkError, RequestAbortedError } from '@b2b-system/web-core/client';
import { AppError } from '@b2b-system/web-core/errors';

export interface FileTextParams {
  /** `StoredFile.url`（inline 的 presigned GET）。 */
  url: string;
  /** 只讀前這麼多位元組（`Range`），大檔也不會整份下載。 */
  maxBytes: number;
}

export interface FileText {
  text: string;
  /** 檔案比 `maxBytes` 大，只讀了開頭。 */
  truncated: boolean;
}

/**
 * 讀檔案內容當文字（預覽用）。對象是物件儲存而不是 api：不經過 `HttpContext`，
 * 也不能帶 Authorization（presigned URL 自己帶簽章；同 `putToStorage`）。
 */
export async function fetchFileText(
  params: FileTextParams,
  signal?: AbortSignal,
): Promise<FileText> {
  let response: Response;
  try {
    response = await fetch(params.url, {
      headers: { Range: `bytes=0-${params.maxBytes}` },
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw new RequestAbortedError(AbortReason.CALLER);
    throw new NetworkError(error);
  }
  // 網址過期（403）或檔案已刪除（404）：對使用者而言都是「找不到這個檔案」，重新查詢即可
  if (!response.ok) throw new AppError('FILE_NOT_FOUND', response.status);
  const buffer = await response.arrayBuffer();
  const truncated = buffer.byteLength > params.maxBytes;
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, params.maxBytes));
  // 截斷處可能切在多位元組字元中間：fatal=false 會把殘缺的字元換成 U+FFFD，而不是整份失敗
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(bytes), truncated };
}
