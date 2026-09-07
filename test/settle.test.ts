import { describe, expect, it, vi } from 'vitest'
import { decodePaymentHeader, PAYMENT_HEADER, settle } from '../src/settle.ts'

const requirements = { scheme: 'exact' } as never

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('PAYMENT_HEADER', () => {
  it('is the v2 header, not X-PAYMENT', () => {
    expect(PAYMENT_HEADER).toBe('PAYMENT-SIGNATURE')
  })
})

describe('decodePaymentHeader', () => {
  it('decodes unpadded base64url, which is what protocol tooling sends', () => {
    const payload = { x402Version: 2, scheme: 'exact' }
    const raw = Buffer.from(JSON.stringify(payload)).toString('base64url')
    expect(decodePaymentHeader(raw)).toEqual(payload)
  })

  it('throws on something that is not base64url JSON', () => {
    expect(() => decodePaymentHeader('not-a-payload')).toThrow(/payment payload/i)
  })
})

describe('settle', () => {
  it('posts the three-field envelope the facilitator expects', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: true }))
    await settle({
      facilitatorUrl: 'http://f',
      paymentPayload: { a: 1 },
      paymentRequirements: requirements,
      fetchImpl: fetchImpl as never,
    })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('http://f/settle')
    expect(JSON.parse((init as Record<string, unknown>).body as string)).toEqual({
      x402Version: 2,
      paymentPayload: { a: 1 },
      paymentRequirements: requirements,
    })
  })

  it('treats success: true as settled', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: true }))
    const result = await settle({
      facilitatorUrl: 'http://f',
      paymentPayload: {},
      paymentRequirements: requirements,
      fetchImpl: fetchImpl as never,
    })
    expect(result).toEqual({ ok: true })
  })

  it('treats HTTP 200 with success: false as a REJECTED payment', async () => {
    // The trap this whole module exists for: a rejected payment is a 200.
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ success: false, errorReason: 'invalid_payment', errorMessage: 'bad token' }),
    )
    const result = await settle({
      facilitatorUrl: 'http://f',
      paymentPayload: {},
      paymentRequirements: requirements,
      fetchImpl: fetchImpl as never,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_payment', message: 'bad token' })
  })

  it('treats a 400 envelope error as a failure too', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad envelope' }, 400))
    const result = await settle({
      facilitatorUrl: 'http://f',
      paymentPayload: {},
      paymentRequirements: requirements,
      fetchImpl: fetchImpl as never,
    })
    expect(result).toMatchObject({ ok: false, reason: 'invalid_request' })
  })
})
