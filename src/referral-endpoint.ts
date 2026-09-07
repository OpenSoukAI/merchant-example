import { Hono } from 'hono'
import type { Address, Config } from './config.ts'
import { build402, buildRequirements } from './payment-requirements.ts'
import {
  decodePaymentHeader,
  INDETERMINATE_REASONS,
  PAYMENT_HEADER,
  settle,
} from './settle.ts'

/**
 * The referral route. One handler, registered on both methods, with exactly one
 * branch: is this the probe for a 402, or the retry carrying a payment?
 *
 * There is deliberately no direct-vs-referral branch. This endpoint exists only
 * for referral traffic, so `payTo` is always the split router and the referral
 * headers are echoed rather than tested. The merchant's ordinary route is a
 * separate file, and untouched.
 */
export function referralApp(
  cfg: Config,
  resolveSplitRouter: () => Promise<Address>,
  deps: { fetchImpl?: typeof fetch } = {},
): Hono {
  const app = new Hono()

  // Both methods: buyer tooling POSTs the probe and the retry; the readiness
  // probe GETs. An endpoint registered on POST alone reports as not ready.
  app.on(['GET', 'POST'], '/', async (c) => {
    // Resolving the router is an RPC call, so it fails whenever the chain is
    // unreachable — the first thing anyone running this locally hits, and left
    // unguarded it surfaces as Hono's bare `500 Internal Server Error` with no
    // body. 503 is the honest status: nothing has been attempted, no payment
    // exists, and retrying later is safe. The viem error is logged rather than
    // returned, because it carries the RPC URL.
    let payTo: Address
    try {
      payTo = await resolveSplitRouter()
    } catch (err) {
      console.error('cannot resolve the split router from the address registry:', err)
      return c.json(
        {
          success: false,
          errorReason: 'split_router_unresolved',
          errorMessage:
            'cannot reach the address registry to resolve the split router — check MERCHANT_RPC_URL and MERCHANT_ADDRESS_REGISTRY',
        },
        503,
      )
    }

    const requirements = buildRequirements(cfg, payTo)
    const raw = c.req.header(PAYMENT_HEADER)

    if (raw === undefined) {
      return c.json(
        build402({
          cfg,
          payTo,
          attributionToken: c.req.header('X-Referrer-Token') ?? '',
          buyerAgentId: c.req.header('X-Referrer-Buyer-Agent-Id') ?? null,
        }),
        402,
      )
    }

    let paymentPayload: unknown
    try {
      paymentPayload = decodePaymentHeader(raw)
    } catch {
      return c.json({ success: false, errorReason: 'invalid_request' }, 402)
    }

    const result = await settle({
      facilitatorUrl: cfg.facilitatorUrl,
      paymentPayload,
      paymentRequirements: requirements,
      fetchImpl: deps.fetchImpl,
    })
    if (!result.ok) {
      return c.json(
        {
          success: false,
          errorReason: result.reason,
          errorMessage: result.message,
          // Forwarded, not swallowed: a wrong-typehash rejection is one
          // re-signature away with nothing spent on-chain, and dropping
          // `retryable` turns that one-retry loop into a stuck integration. The
          // undefined ones do not survive JSON, so an ordinary rejection's body
          // is unchanged.
          retryable: result.retryable,
          requiredAuthorizationType: result.requiredAuthorizationType,
          setup_url: result.setup_url,
        },
        // 402 asks the buyer to pay, so only a refusal — the facilitator answered
        // and said no — may use it. When the facilitator did not answer, the
        // transfer may still be landing, and a buyer that reads a refusal re-signs
        // over a fresh nonce and pays twice. 504 says what is actually true: the
        // outcome is unknown. `ok: false` either way, so the product is never
        // served on an unconfirmed payment.
        INDETERMINATE_REASONS.has(result.reason) ? 504 : 402,
      )
    }

    // Settled. Serve whatever the paid route serves — unchanged from the direct
    // route, which is the point: the protocol does not touch your product code.
    return c.json({ ok: true, resource: 'your paid response goes here' })
  })

  return app
}
