import { Hono } from 'hono'
import type { Address, Config } from './config.ts'
import { build402, buildRequirements } from './payment-requirements.ts'
import { decodePaymentHeader, PAYMENT_HEADER, settle } from './settle.ts'

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
    const payTo = await resolveSplitRouter()
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
      return c.json({ success: false, errorReason: result.reason, errorMessage: result.message }, 402)
    }

    // Settled. Serve whatever the paid route serves — unchanged from the direct
    // route, which is the point: the protocol does not touch your product code.
    return c.json({ ok: true, resource: 'your paid response goes here' })
  })

  return app
}
