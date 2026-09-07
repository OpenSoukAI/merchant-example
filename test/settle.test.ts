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

  it("hands the facilitator's own explanation back on a 400 envelope error", async () => {
    // The real 400 shape. Both of the facilitator's 400 branches — a body it cannot
    // bind, and a wrong x402Version — answer with exactly these three fields, and
    // this is the one sentence that says what the envelope got wrong.
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          success: false,
          errorReason: 'invalid_request',
          errorMessage: 'unsupported x402Version 0 (want 2)',
        },
        400,
      ),
    )
    const result = await settle({
      facilitatorUrl: 'http://f',
      paymentPayload: {},
      paymentRequirements: requirements,
      fetchImpl: fetchImpl as never,
    })
    expect(result).toEqual({
      ok: false,
      reason: 'invalid_request',
      message: 'unsupported x402Version 0 (want 2)',
    })
  })

  it('names the status when a 400 body carries no explanation at all', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 400))
    const result = await settle({
      facilitatorUrl: 'http://f',
      paymentPayload: {},
      paymentRequirements: requirements,
      fetchImpl: fetchImpl as never,
    })
    expect(result).toEqual({
      ok: false,
      reason: 'invalid_request',
      message: 'facilitator answered 400',
    })
  })

  it('reports an unreadable 2xx as malformed, not as a refusal', async () => {
    // A proxy's HTML error page under a 200. "I could not read the answer" must not
    // become "the payment was refused", and must not become "sale completed" either.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('<html>gateway</html>', { status: 200 }))
    const result = await settle({
      facilitatorUrl: 'http://f',
      paymentPayload: {},
      paymentRequirements: requirements,
      fetchImpl: fetchImpl as never,
    })
    expect(result).toEqual({
      ok: false,
      reason: 'malformed_response',
      message: 'facilitator answered 200 with a body that is not JSON',
    })
  })

  it('bounds the call, rather than inheriting undici\'s 300 s default', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: true }))
    await settle({
      facilitatorUrl: 'http://f',
      paymentPayload: {},
      paymentRequirements: requirements,
      fetchImpl: fetchImpl as never,
    })
    const [, init] = fetchImpl.mock.calls[0]!
    expect((init as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal)
  })

  it('gives a timeout its own reason, because a timeout is not a rejection', async () => {
    // What AbortSignal.timeout rejects the fetch with.
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new DOMException('This operation was aborted', 'TimeoutError'))
    const result = await settle({
      facilitatorUrl: 'http://f',
      paymentPayload: {},
      paymentRequirements: requirements,
      fetchImpl: fetchImpl as never,
    })
    expect(result).toEqual({
      ok: false,
      reason: 'facilitator_timeout',
      message: 'facilitator did not answer within 60s',
    })
  })
})
