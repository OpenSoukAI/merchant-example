import { describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config.ts'
import { createServer } from '../src/server.ts'

const cfg = loadConfig({
  MERCHANT_RPC_URL: 'http://127.0.0.1:8545',
  MERCHANT_ADDRESS_REGISTRY: '0x1111111111111111111111111111111111111111',
  MERCHANT_USDC: '0x2222222222222222222222222222222222222222',
  MERCHANT_NETWORK: 'eip155:8453',
  MERCHANT_PRICE_BASE_UNITS: '1000000',
  MERCHANT_FACILITATOR_URL: 'http://f',
  MERCHANT_PUBLIC_URL: 'https://api.example.com',
  MERCHANT_DIRECT_PAY_TO: '0x3333333333333333333333333333333333333333',
})
const ROUTER = '0x4444444444444444444444444444444444444444'
const app = (fetchImpl?: typeof fetch) =>
  createServer(cfg, { resolveSplitRouter: async () => ROUTER as never, fetchImpl })

// Narrow shapes for `res.json()`, which types as `unknown` here (no DOM lib —
// see ruling R14) — just enough of each body for the assertions that read it.
type PaymentRequiredBody = {
  accepts: [{ payTo: string }]
  extensions?: { attributionToken?: string; buyerAgentId?: string }
}
type SettleErrorBody = {
  success?: boolean
  errorReason: string
  retryable?: boolean
  requiredAuthorizationType?: string
  setup_url?: string
}

describe('the referral endpoint', () => {
  it('answers 402 on POST, which is what buyer tooling sends', async () => {
    const res = await app().request('/buy/referral', { method: 'POST' })
    expect(res.status).toBe(402)
    const body = (await res.json()) as PaymentRequiredBody
    expect(body.accepts[0].payTo).toBe(ROUTER)
  })

  it('answers 402 on GET, which is what the readiness probe sends', async () => {
    // mock-merchant registers POST only and therefore reports as not ready.
    const res = await app().request('/buy/referral', { method: 'GET' })
    expect(res.status).toBe(402)
    expect(((await res.json()) as PaymentRequiredBody).accepts[0].payTo).toBe(ROUTER)
  })

  it('echoes the referral headers into extensions', async () => {
    const res = await app().request('/buy/referral', {
      method: 'GET',
      headers: { 'X-Referrer-Token': 'eyJ2Ijo0', 'X-Referrer-Buyer-Agent-Id': '7' },
    })
    const body = (await res.json()) as PaymentRequiredBody
    expect(body.extensions?.attributionToken).toBe('eyJ2Ijo0')
    expect(body.extensions?.buyerAgentId).toBe('7')
  })

  it('serves the resource when the facilitator settles', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    )
    const payment = Buffer.from(JSON.stringify({ x402Version: 2 })).toString('base64url')
    const res = await app(fetchImpl as never).request('/buy/referral', {
      method: 'POST',
      headers: { 'PAYMENT-SIGNATURE': payment },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
  })

  it('does NOT serve the resource on 200 + success:false', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, errorReason: 'invalid_payment' }), {
        status: 200,
      }),
    )
    const payment = Buffer.from(JSON.stringify({ x402Version: 2 })).toString('base64url')
    const res = await app(fetchImpl as never).request('/buy/referral', {
      method: 'POST',
      headers: { 'PAYMENT-SIGNATURE': payment },
    })
    expect(res.status).toBe(402)
    expect(((await res.json()) as SettleErrorBody).errorReason).toBe('invalid_payment')
  })

  it('separates "unknown" from "refused" by status, not by a reason string', async () => {
    // A timed-out settle may still be landing on-chain. Answering 402 — the status
    // that asks for payment — invites the buyer to re-sign over a fresh nonce and
    // pay a second time, so the indeterminate case gets 504 and only a real
    // refusal gets 402. Neither serves the product.
    const payment = Buffer.from(JSON.stringify({ x402Version: 2 })).toString('base64url')
    const send = (fetchImpl: unknown) =>
      app(fetchImpl as never).request('/buy/referral', {
        method: 'POST',
        headers: { 'PAYMENT-SIGNATURE': payment },
      })

    const timedOut = await send(
      vi.fn().mockRejectedValue(new DOMException('This operation was aborted', 'TimeoutError')),
    )
    const refused = await send(
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: false, errorReason: 'invalid_payment' }), {
          status: 200,
        }),
      ),
    )

    expect(timedOut.status).toBe(504)
    expect(refused.status).toBe(402)
    expect((await timedOut.json()) as SettleErrorBody).toMatchObject({
      success: false,
      errorReason: 'facilitator_timeout',
    })
    expect(await refused.json()).not.toMatchObject({ ok: true })
  })

  it('forwards a retryable rejection to the buyer, hint and all', async () => {
    // The failure a new integration hits first: the buyer signed the x402 default.
    // The 402 must carry the facilitator's own machine-readable retry, or buyer
    // tooling has nothing to act on but prose.
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          errorReason: 'invalid_payment',
          errorMessage: 'authorization signature recovers under TransferWithAuthorization…',
          requiredAuthorizationType: 'ReceiveWithAuthorization',
          retryable: true,
          setup_url: 'http://f/.well-known/referrer-agent',
        }),
        { status: 200 },
      ),
    )
    const payment = Buffer.from(JSON.stringify({ x402Version: 2 })).toString('base64url')
    const res = await app(fetchImpl as never).request('/buy/referral', {
      method: 'POST',
      headers: { 'PAYMENT-SIGNATURE': payment },
    })
    expect(res.status).toBe(402)
    const body = (await res.json()) as SettleErrorBody
    expect(body.retryable).toBe(true)
    expect(body.requiredAuthorizationType).toBe('ReceiveWithAuthorization')
    expect(body.setup_url).toBe('http://f/.well-known/referrer-agent')
  })

  it('ignores X-PAYMENT, the v1 header', async () => {
    const payment = Buffer.from(JSON.stringify({ x402Version: 2 })).toString('base64url')
    const res = await app().request('/buy/referral', {
      method: 'POST',
      headers: { 'X-PAYMENT': payment },
    })
    expect(res.status).toBe(402) // treated as no payment at all
  })
})

describe('the direct endpoint', () => {
  it('is paid on the merchant’s own wallet, untouched by any of this', async () => {
    const res = await app().request('/buy', { method: 'POST' })
    expect(res.status).toBe(402)
    const body = (await res.json()) as PaymentRequiredBody
    expect(body.accepts[0].payTo).toBe(cfg.directPayTo)
    expect(body.extensions).toBeUndefined()
  })
})
