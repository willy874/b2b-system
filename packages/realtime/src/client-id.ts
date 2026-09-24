/** 分頁 instance id 的 header：伺服器放進推播的 `origin`，只用來去重，不做授權判斷。 */
export const CLIENT_ID_HEADER = 'x-client-id';

const CLIENT_ID_PATTERN = /^[A-Za-z0-9:-]{1,64}$/;

export function isValidClientId(value: unknown): value is string {
  return typeof value === 'string' && CLIENT_ID_PATTERN.test(value);
}
