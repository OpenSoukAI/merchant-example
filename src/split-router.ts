import { keccak256, toHex } from 'viem'
import type { Address } from './config.ts'

/**
 * The registry keys on keccak256 of the constant's own name, as ASCII bytes.
 * `cast keccak SPLIT_ROUTER` gives the same value.
 */
export const SPLIT_ROUTER_KEY = keccak256(toHex('SPLIT_ROUTER'))

export type RegistryRead = (key: `0x${string}`) => Promise<Address>

const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getAddress',
    stateMutability: 'view',
    inputs: [{ name: 'key', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

/** Binds a viem public client to one registry address. */
export function registryRead(
  client: { readContract: (args: unknown) => Promise<unknown> },
  registry: Address,
): RegistryRead {
  return async (key) =>
    (await client.readContract({
      address: registry,
      abi: REGISTRY_ABI,
      functionName: 'getAddress',
      args: [key],
    })) as Address
}

/**
 * Resolving rather than configuring the split router is the point of this file.
 * The registry's entries are changed behind a timelock, so an endpoint that
 * hardcodes the router keeps naming the old one after a change — and a `402`
 * naming the wrong `payTo` does not settle.
 *
 * Cached, because a 402 is a hot path and this is one `eth_call`. A failure is
 * NOT cached: the next request retries rather than inheriting an outage.
 */
export function createSplitRouterResolver(opts: {
  read: RegistryRead
  ttlMs?: number
  now?: () => number
}): () => Promise<Address> {
  const ttl = opts.ttlMs ?? 60_000
  const now = opts.now ?? Date.now
  let cached: { value: Address; at: number } | null = null

  return async () => {
    if (cached !== null && now() - cached.at < ttl) return cached.value
    const value = await opts.read(SPLIT_ROUTER_KEY)
    cached = { value, at: now() }
    return value
  }
}
