export type Address = `0x${string}`
export type Hex = `0x${string}`

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
  /**
   * The bytes32 id this merchant chose for the product at add_product, lowercase 0x-hex.
   * Emitted as `extra.productId` so the facilitator knows which product this endpoint sold
   * when a buyer pays with a ref link minted for a sibling product (REF-315).
   */
  productId: Address
  /**
   * The key this server signs `/settle` with, so the facilitator can tell the seller asked
   * for the settlement rather than a buyer holding a public ref link (REF-324).
   *
   * A dedicated hot key granted `SETTLEMENT_SIGNER_ROLE`, NOT the merchant's owner key. The
   * grant must land BEFORE this server starts signing: an unrecognised signature is refused
   * whatever the facilitator's rollout flag says, so the order is grant first, then deploy.
   */
  signerPrivateKey: Hex
  facilitatorUrl: string
  /**
   * The protocol API's base URL — NOT the facilitator's. The onboarding manifest
   * at `/.well-known/opensouk` is served by the API; the facilitator serves
   * `/verify`, `/settle`, `/supported` and nothing under `/.well-known`, so
   * deriving `setup_url` from `facilitatorUrl` yields a 404 for the one reader it
   * exists for — a cold agent that has just failed to pay.
   */
  apiUrl: string
  publicUrl: string
  /** The wallet the merchant's own, untouched route is paid on. */
  directPayTo: Address
}

export class MissingConfigError extends Error {
  // Declared and assigned separately rather than as a constructor parameter
  // property. A parameter property is not erasable syntax, so `node src/server.ts`
  // cannot run it — Node strips types, it does not transform them (ruling R13).
  readonly missing: string[]

  constructor(missing: string[]) {
    super(`missing required environment variables: ${missing.join(', ')}`)
    this.name = 'MissingConfigError'
    this.missing = missing
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
  'MERCHANT_PRODUCT_ID',
  'MERCHANT_SIGNER_PRIVATE_KEY',
  'MERCHANT_FACILITATOR_URL',
  'MERCHANT_API_URL',
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

  const rawProductId = env.MERCHANT_PRODUCT_ID as string
  const productHex = rawProductId.replace(/^0[xX]/, '')
  if (!/^[0-9a-fA-F]{64}$/.test(productHex)) {
    throw new Error(
      `MERCHANT_PRODUCT_ID must be the 32-byte hex product id you registered with add_product, got ${rawProductId}`,
    )
  }

  const signerKey = env.MERCHANT_SIGNER_PRIVATE_KEY as string
  if (!/^0x[0-9a-fA-F]{64}$/.test(signerKey)) {
    // The value is never echoed back: a wrong key is still a key, and config errors get
    // pasted into issues and chat. The variable name is enough to act on.
    throw new Error(
      'MERCHANT_SIGNER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex private key — the hot ' +
        'key you granted SETTLEMENT_SIGNER_ROLE, not the merchant owner key',
    )
  }

  return {
    port: Number(env.MERCHANT_PORT ?? '8083'),
    rpcUrl: env.MERCHANT_RPC_URL as string,
    addressRegistry: env.MERCHANT_ADDRESS_REGISTRY as Address,
    usdc: env.MERCHANT_USDC as Address,
    network: env.MERCHANT_NETWORK as string,
    priceBaseUnits: price,
    productId: `0x${productHex.toLowerCase()}`,
    signerPrivateKey: signerKey as Hex,
    facilitatorUrl: (env.MERCHANT_FACILITATOR_URL as string).replace(/\/$/, ''),
    apiUrl: (env.MERCHANT_API_URL as string).replace(/\/$/, ''),
    publicUrl: (env.MERCHANT_PUBLIC_URL as string).replace(/\/$/, ''),
    directPayTo: env.MERCHANT_DIRECT_PAY_TO as Address,
  }
}
