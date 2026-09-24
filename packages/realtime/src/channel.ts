import { z } from 'zod';

/** 與前端 `shared/channel/envelope.ts` 的 `CHANNEL_ENVELOPE_TAG` 相同；伺服器只認外框、不認 payload。 */
const CHANNEL_ENVELOPE_TAG = 'ge-channel';

/** 可以經伺服器轉到同使用者其他裝置的頻道；`session:*` 帶 token，永遠不在清單內。 */
export const RELAYABLE_CHANNEL_PREFIXES = ['ge:store:preference:'] as const;

/** 序列化後的外框上限（位元組）。 */
export const MAX_RELAY_ENVELOPE_BYTES = 4096;

export const ChannelEnvelopeWireSchema = z.object({
  tag: z.literal(CHANNEL_ENVELOPE_TAG),
  channel: z.string().min(1).max(128),
  type: z.string().min(1).max(64),
  payload: z.unknown(),
  sender: z.string().min(1).max(64),
  id: z.string().min(1).max(128),
});

export type ChannelEnvelopeWire = z.infer<typeof ChannelEnvelopeWireSchema>;

export function isRelayableChannel(channel: string): boolean {
  return RELAYABLE_CHANNEL_PREFIXES.some((prefix) => channel.startsWith(prefix));
}
