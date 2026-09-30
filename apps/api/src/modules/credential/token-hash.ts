import { createHash } from 'node:crypto';

/** token 只存雜湊，原文不落地。 */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
