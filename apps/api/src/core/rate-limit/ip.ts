import { BlockList, isIP } from 'node:net';

import { normalizeIp } from '@nestjs/throttler';

/** 計數用的 IP 前綴：IPv4 是完整位址、IPv6 是 /64（同一個網段的使用者通常拿到同一個 /64 裡的不同位址）。 */
export function ipPrefixOf(ip: string | undefined): string {
  return normalizeIp(ip ?? 'unknown');
}

/**
 * 逗號或空白分隔的 CIDR（或單一位址）→ 判斷函式；格式不對的項目略過（輸入在寫入時已驗證）。
 * 空字串回傳永遠 false 的函式。
 */
export function cidrMatcher(list: string | undefined): (ip: string | undefined) => boolean {
  const blocks = new BlockList();
  let any = false;
  for (const entry of (list ?? '').split(/[\s,]+/).filter(Boolean)) {
    const [address = '', prefix] = entry.split('/');
    const family = isIP(address);
    if (family === 0) continue;
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) blocks.addAddress(address, type);
    else blocks.addSubnet(address, Number(prefix), type);
    any = true;
  }
  if (!any) return () => false;
  return (ip) => {
    if (!ip) return false;
    const address = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    const family = isIP(address);
    return family !== 0 && blocks.check(address, family === 4 ? 'ipv4' : 'ipv6');
  };
}

/** 一段 CIDR 清單是否每一項都合法（feature 參數、環境變數的驗證）。 */
export function isCidrList(value: string): boolean {
  return value
    .split(/[\s,]+/)
    .filter(Boolean)
    .every((entry) => {
      const [address = '', prefix, extra] = entry.split('/');
      if (extra !== undefined) return false;
      const family = isIP(address);
      if (family === 0) return false;
      if (prefix === undefined) return true;
      if (!/^\d{1,3}$/.test(prefix)) return false;
      return Number(prefix) <= (family === 4 ? 32 : 128);
    });
}
