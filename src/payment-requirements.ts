import type { Address, Config } from './config.ts'

/**
 * NOT the x402 default. `SplitRouter.route()` calls `receiveWithAuthorization`,
 * and ERC-3009's `TransferWithAuthorization` has identical fields under a
 * different struct name — so it hashes to a different digest and USDC rejects
 * it. Advertising the type is how a buyer knows which one to sign (REF-269).
 */
export const AUTHORIZATION_TYPE = 'ReceiveWithAuthorization'

export type PaymentRequirements = {
  scheme: 'exact'
  network: string
  asset: Address
  amount: string
  payTo: Address
  maxTimeoutSeconds: number
  extra: {
    name: string
    version: string
    authorizationType: string
    /** Non-standard, and how a tool-less buyer finds the facilitator to settle through. */
    facilitatorUrl: string
  }
}

export type PaymentRequired = {
  x402Version: 2
  resource: { url: string; description: string; mimeType: string }
  accepts: PaymentRequirements[]
  extensions: {
    attributionToken: string
    buyerAgentId?: string
    setup_url: string
  }
}

export function buildRequirements(cfg: Config, payTo: Address): PaymentRequirements {
  return {
    scheme: 'exact',
    network: cfg.network,
    asset: cfg.usdc,
    amount: cfg.priceBaseUnits,
    payTo,
    maxTimeoutSeconds: 60,
    extra: {
      name: 'USD Coin',
      version: '2',
      authorizationType: AUTHORIZATION_TYPE,
      facilitatorUrl: cfg.facilitatorUrl,
    },
  }
}

export function build402(args: {
  cfg: Config
  payTo: Address
  attributionToken: string
  buyerAgentId: string | null
}): PaymentRequired {
  const { cfg, payTo, attributionToken, buyerAgentId } = args
  return {
    x402Version: 2,
    resource: {
      url: `${cfg.publicUrl}/buy/referral`,
      description: 'Purchase via referral',
      mimeType: 'application/json',
    },
    accepts: [buildRequirements(cfg, payTo)],
    extensions: {
      attributionToken,
      // Omitted rather than empty: an absent id is what marks an agent-less
      // purchase, and the facilitator substitutes its own sentinel for it.
      ...(buyerAgentId === null ? {} : { buyerAgentId }),
      // The API host, never the facilitator's: only the API serves this manifest.
      setup_url: `${cfg.apiUrl}/.well-known/referrer-agent`,
    },
  }
}
