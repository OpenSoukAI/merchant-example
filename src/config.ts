export type Address = `0x${string}`

export type Config = {
  port: number
  rpcUrl: string
  /**
   * ProtocolAddressRegistry. The ONE address this example hardcodes, because it
   * is the one address the protocol treats as permanent — every other protocol
   * address is read out of it (see src/split-router.ts).
   */
  addressRegistry: Address
  usdc: Address
  /** CAIP-2, e.g. `eip155:8453`. Goes into `accepts[0].network` verbatim. */
  network: string
  /** USDC base units, 6 decimals. A string because a uint256 does not survive a JSON number. */
  priceBaseUnits: string
  facilitatorUrl: string
  publicUrl: string
  /** The wallet the merchant's own, untouched route is paid on. */
  directPayTo: Address
}

export class MissingConfigError extends Error {
  constructor(readonly missing: string[]) {
    super(`missing required environment variables: ${missing.join(', ')}`)
    this.name = 'MissingConfigError'
  }
}

// Deliberately NOT in alphabetical order: `loadConfig` sorts the missing list, and
// a list already sorted here would let that sort be deleted without any test
// noticing (ruling R10). Order here is grouped by what a reader configures first.
const REQUIRED = [
  'MERCHANT_RPC_URL',
  'MERCHANT_ADDRESS_REGISTRY',
  'MERCHANT_USDC',
  'MERCHANT_NETWORK',
  'MERCHANT_PRICE_BASE_UNITS',
  'MERCHANT_FACILITATOR_URL',
  'MERCHANT_PUBLIC_URL',
  'MERCHANT_DIRECT_PAY_TO',
] as const

export function loadConfig(env: Record<string, string | undefined>): Config {
  const missing = REQUIRED.filter((key) => !env[key]).sort()
  if (missing.length > 0) throw new MissingConfigError(missing)

  const price = env.MERCHANT_PRICE_BASE_UNITS as string
  if (!/^[0-9]+$/.test(price)) {
    throw new Error(
      `MERCHANT_PRICE_BASE_UNITS must be an integer number of USDC base units (6 decimals), got ${price}`,
    )
  }

  return {
    port: Number(env.MERCHANT_PORT ?? '8083'),
    rpcUrl: env.MERCHANT_RPC_URL as string,
    addressRegistry: env.MERCHANT_ADDRESS_REGISTRY as Address,
    usdc: env.MERCHANT_USDC as Address,
    network: env.MERCHANT_NETWORK as string,
    priceBaseUnits: price,
    facilitatorUrl: (env.MERCHANT_FACILITATOR_URL as string).replace(/\/$/, ''),
    publicUrl: (env.MERCHANT_PUBLIC_URL as string).replace(/\/$/, ''),
    directPayTo: env.MERCHANT_DIRECT_PAY_TO as Address,
  }
}
