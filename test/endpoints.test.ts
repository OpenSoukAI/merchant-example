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

describe('the referral endpoint', () => {
  it('answers 402 on POST, which is what buyer tooling sends', async () => {
    const res = await app().request('/buy/referral', { method: 'POST' })
    expect(res.status).toBe(402)
    const body = (await res.json()) as any
    expect(body.accepts[0].payTo).toBe(ROUTER)
  })

  it('answers 402 on GET, which is what the readiness probe sends', async () => {
    // mock-merchant registers POST only and therefore reports as not ready.
    const res = await app().request('/buy/referral', { method: 'GET' })
    expect(res.status).toBe(402)
    expect(((await res.json()) as any).accepts[0].payTo).toBe(ROUTER)
  })

  it('echoes the referral headers into extensions', async () => {
    const res = await app().request('/buy/referral', {
      method: 'GET',
      headers: { 'X-Referrer-Token': 'eyJ2Ijo0', 'X-Referrer-Buyer-Agent-Id': '7' },
    })
    const body = (await res.json()) as any
    expect(body.extensions.attributionToken).toBe('eyJ2Ijo0')
    expect(body.extensions.buyerAgentId).toBe('7')
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
    expect(((await res.json()) as any).errorReason).toBe('invalid_payment')
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
    const body = (await res.json()) as any
    expect(body.accepts[0].payTo).toBe(cfg.directPayTo)
    expect(body.extensions).toBeUndefined()
  })
})
