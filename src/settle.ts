import type { PaymentRequirements } from './payment-requirements.ts'

/**
 * x402 v2. `X-PAYMENT` is the v1 header, and the onboarding manifest's prose
 * recipe still names it — a merchant that reads only that one never sees a
 * payment from protocol tooling.
 */
export const PAYMENT_HEADER = 'PAYMENT-SIGNATURE'

export function decodePaymentHeader(raw: string): unknown {
  try {
    // Unpadded base64url is what the protocol's buyer tooling sends. Node's
    // 'base64url' decoder also accepts standard base64, so one call covers both.
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch (cause) {
    throw new Error('undecodable payment payload', { cause })
  }
}

export type SettleResult = { ok: true } | SettleFailure

export type SettleFailure = {
  ok: false
  reason: string
  message: string
  /**
   * The facilitator sets these two together, and only when the rejection is a
   * signature made over TransferWithAuthorization: validation is off-chain, so
   * nothing was sent and `authorizationState(buyer, nonce)` is still false, and
   * re-signing the SAME authorization under `requiredAuthorizationType` settles.
   * A caller branches on `retryable` rather than matching the message, which is
   * why the facilitator sends it as a field (REF-269).
   */
  retryable?: boolean
  requiredAuthorizationType?: string
  /**
   * The onboarding manifest, present on any rejection when the facilitator is
   * configured with one — the breadcrumb for a buyer that arrived with no tooling
   * (REF-133). Under the facilitator's own snake_case name, like the one in the
   * 402's `extensions`.
   */
  setup_url?: string
}

/**
 * The reasons that mean the facilitator did NOT refuse the payment: it never
 * answered, broke, or answered something unreadable. The on-chain transfer may
 * have landed anyway, so a caller must not be invited to retry — a retry is a
 * second signature over a fresh nonce, which is a second payment.
 */
export const INDETERMINATE_REASONS: ReadonlySet<string> = new Set([
  'facilitator_timeout',
  'facilitator_unavailable',
  'malformed_response',
])

/**
 * `/settle` waits for on-chain confirmation, and the facilitator gives up at its
 * own 60 s write deadline — so nothing useful arrives after that. undici's default
 * is 300 s, which would hold a buyer's request open for five minutes against a
 * facilitator that has already stopped answering. The reference merchant bounds
 * the same call at 60 s.
 */
const SETTLE_TIMEOUT_MS = 60_000

/**
 * The `/settle` response. `errorReason`/`errorMessage` on every failure branch,
 * including the two 400s; there is no `error` field, which is the x402 v1 name and
 * reading it discards the one sentence that says what the envelope got wrong.
 */
type SettleResponse = {
  success?: boolean
  errorReason?: string
  errorMessage?: string
  setup_url?: string
  requiredAuthorizationType?: string
  retryable?: boolean
}

/**
 * A rejected payment comes back as HTTP 200 with `success: false`. Branching on
 * the status code alone therefore reads a refusal as a completed sale, which is
 * the single most expensive mistake available on this path.
 */
export async function settle(args: {
  facilitatorUrl: string
  paymentPayload: unknown
  paymentRequirements: PaymentRequirements
  fetchImpl?: typeof fetch
}): Promise<SettleResult> {
  const doFetch = args.fetchImpl ?? fetch
  let res: Response
  try {
    res = await doFetch(`${args.facilitatorUrl}/settle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        x402Version: 2,
        paymentPayload: args.paymentPayload,
        paymentRequirements: args.paymentRequirements,
      }),
      signal: AbortSignal.timeout(SETTLE_TIMEOUT_MS),
    })
  } catch (err) {
    // Its own reason, because a timeout is not a refusal: the transaction may
    // still land after we stop listening, so a merchant must neither serve the
    // product nor tell the buyer the payment was rejected.
    if (err instanceof Error && err.name === 'TimeoutError') {
      return {
        ok: false,
        reason: 'facilitator_timeout',
        message: `facilitator did not answer within ${SETTLE_TIMEOUT_MS / 1000}s`,
      }
    }
    throw err
  }

  // `null`, not `{}`: an unparsable 2xx body would otherwise fall through to the
  // `success !== true` branch and be reported as a refusal that never happened.
  const body = (await res.json().catch(() => null)) as SettleResponse | null

  if (!res.ok) {
    return {
      ok: false,
      // A 4xx is the facilitator saying the request was bad, and it is the only
      // status class that means that. A 5xx says the facilitator broke while
      // handling a request that may have been perfectly good — telling a merchant
      // their envelope is malformed during someone else's outage sends them
      // debugging their own correct code.
      reason: res.status >= 500 ? 'facilitator_unavailable' : 'invalid_request',
      message: body?.errorMessage ?? body?.errorReason ?? `facilitator answered ${res.status}`,
    }
  }
  if (body === null) {
    return {
      ok: false,
      reason: 'malformed_response',
      message: `facilitator answered ${res.status} with a body that is not JSON`,
    }
  }
  if (body.success === true) return { ok: true }
  return {
    ok: false,
    // The facilitator's own reason, never a locally minted one: it is what the
    // merchant's 402 re-emits, so a substitute would teach buyer tooling a
    // vocabulary this rail does not use.
    reason: body.errorReason ?? 'unknown',
    message: body.errorMessage ?? 'facilitator refused the payment',
    // Passed through, absent on the rejections that do not carry them. The
    // facilitator attaches the typehash hint to exactly one failure and would be
    // misleading on the others, so it is never synthesised here.
    retryable: body.retryable,
    requiredAuthorizationType: body.requiredAuthorizationType,
    setup_url: body.setup_url,
  }
}
