import { concat, keccak256, numberToHex, stringToHex, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { Address } from './config.ts'

/**
 * The facilitator authenticates `/verify` and `/settle` the same way the protocol API
 * authenticates agents: two headers carrying an EIP-191 `personal_sign` over
 * `keccak256(body || uint64_be(unix_seconds))`.
 *
 * It matters because only the seller may create a purchase record. Without it anyone holding
 * a public ref link can post their own settlement and mint an on-chain purchase — the highest
 * review trust tier — for a cent, having bought nothing.
 */
export const SIGNATURE_HEADER = 'X-Agent-Signature'
export const TIMESTAMP_HEADER = 'X-Agent-Timestamp'

/**
 * The 32 bytes that get signed. `body` is the exact request body, as a string — not the
 * object it came from: `JSON.stringify` is free to order keys differently on a second call,
 * and the facilitator hashes the bytes it received, not a re-serialisation of them.
 */
export function settlementPayloadHash(body: string, timestamp: number): Hex {
  // 8 bytes big-endian, matching Go's binary.BigEndian.PutUint64. `numberToHex` left-pads,
  // which is the same order; a decimal string here would hash to something the facilitator
  // never computes.
  return keccak256(concat([stringToHex(body), numberToHex(timestamp, { size: 8 })]))
}

export type SettlementSigner = {
  /** The address the facilitator will recover. Grant it SETTLEMENT_SIGNER_ROLE. */
  readonly address: Address
  /** The two auth headers for this exact body, stamped now. */
  sign(body: string): Promise<Record<string, string>>
}

/**
 * The key here should be a dedicated hot key holding `SETTLEMENT_SIGNER_ROLE`, never the
 * merchant's owner key — the owner key controls rates, delisting, the payout wallet and the
 * identity itself, none of which a web server needs in order to sell something.
 *
 * Each call stamps its own timestamp rather than accepting one, so no caller can cache a
 * signed pair: the facilitator refuses a repeat of the same (signer, body, timestamp) on the
 * same route, and re-sending headers from a failed attempt is exactly that repeat.
 */
export function createSettlementSigner(
  privateKey: Hex,
  opts: { now?: () => number } = {},
): SettlementSigner {
  // Throws here on a malformed key rather than on the first buyer's request.
  const account = privateKeyToAccount(privateKey)
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000))

  return {
    address: account.address,
    async sign(body: string): Promise<Record<string, string>> {
      const timestamp = now()
      const signature = await account.signMessage({
        // `raw`, so viem applies the EIP-191 prefix to these 32 bytes. Passing the hash as a
        // string would sign its 66 ASCII characters instead, which recovers to some other
        // address entirely and is rejected as "not authorized to settle".
        message: { raw: settlementPayloadHash(body, timestamp) },
      })
      return { [SIGNATURE_HEADER]: signature, [TIMESTAMP_HEADER]: String(timestamp) }
    },
  }
}
