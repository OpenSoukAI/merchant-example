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

export type SettleResult = { ok: true } | { ok: false; reason: string; message: string }

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
  const res = await doFetch(`${args.facilitatorUrl}/settle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload: args.paymentPayload,
      paymentRequirements: args.paymentRequirements,
    }),
  })

  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean
    errorReason?: string
    errorMessage?: string
    error?: string
  }

  if (!res.ok) {
    return {
      ok: false,
      reason: 'invalid_request',
      message: body.error ?? `facilitator answered ${res.status}`,
    }
  }
  if (body.success === true) return { ok: true }
  return {
    ok: false,
    reason: body.errorReason ?? 'unknown',
    message: body.errorMessage ?? 'facilitator refused the payment',
  }
}
