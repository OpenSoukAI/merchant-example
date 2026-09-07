import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'
import { AUTHORIZATION_TYPE, build402, buildRequirements } from '../src/payment-requirements.ts'

const cfg = loadConfig({
  MERCHANT_RPC_URL: 'http://127.0.0.1:8545',
  MERCHANT_ADDRESS_REGISTRY: '0x1111111111111111111111111111111111111111',
  MERCHANT_USDC: '0x2222222222222222222222222222222222222222',
  MERCHANT_NETWORK: 'eip155:8453',
  MERCHANT_PRICE_BASE_UNITS: '1000000',
  MERCHANT_FACILITATOR_URL: 'http://127.0.0.1:8082',
  MERCHANT_PUBLIC_URL: 'https://api.example.com',
  MERCHANT_DIRECT_PAY_TO: '0x3333333333333333333333333333333333333333',
})
const ROUTER = '0x4444444444444444444444444444444444444444' as const

describe('buildRequirements', () => {
  it('names the split router as the payment target', () => {
    expect(buildRequirements(cfg, ROUTER).payTo).toBe(ROUTER)
  })

  it("carries USDC's EIP-712 domain, without which the facilitator cannot recover the signature", () => {
    const { extra } = buildRequirements(cfg, ROUTER)
    expect(extra.name).toBe('USD Coin')
    expect(extra.version).toBe('2')
  })

  it('names ReceiveWithAuthorization, not the x402 default', () => {
    // The literal on both lines. Asserting the emitted field against the constant
    // compares the code to itself and holds for any value the constant takes.
    expect(AUTHORIZATION_TYPE).toBe('ReceiveWithAuthorization')
    expect(buildRequirements(cfg, ROUTER).extra.authorizationType).toBe('ReceiveWithAuthorization')
  })

  it('passes the price through as a string of base units', () => {
    expect(buildRequirements(cfg, ROUTER).amount).toBe('1000000')
  })

  it('advertises the only scheme this rail settles', () => {
    expect(buildRequirements(cfg, ROUTER).scheme).toBe('exact')
  })

  it('names the configured token and chain, not a hardcoded pair', () => {
    // `asset` is the contract the hardcoded EIP-712 domain above describes: name the
    // wrong one and every signature recovery fails against a different token.
    const requirements = buildRequirements(cfg, ROUTER)
    expect(requirements.asset).toBe('0x2222222222222222222222222222222222222222')
    expect(requirements.network).toBe('eip155:8453')
  })

  it("leaves 60 seconds for the buyer's signing window", () => {
    expect(buildRequirements(cfg, ROUTER).maxTimeoutSeconds).toBe(60)
  })

  it('carries the facilitator URL a tool-less buyer settles through', () => {
    expect(buildRequirements(cfg, ROUTER).extra.facilitatorUrl).toBe('http://127.0.0.1:8082')
  })
})

describe('build402', () => {
  it('echoes the attribution token verbatim', () => {
    const body = build402({ cfg, payTo: ROUTER, attributionToken: 'eyJ2Ijo0', buyerAgentId: '7' })
    expect(body.extensions.attributionToken).toBe('eyJ2Ijo0')
    expect(body.extensions.buyerAgentId).toBe('7')
  })

  it('omits buyerAgentId entirely when the buyer sent none, rather than sending empty', () => {
    const body = build402({ cfg, payTo: ROUTER, attributionToken: '', buyerAgentId: null })
    expect('buyerAgentId' in body.extensions).toBe(false)
  })

  it('points setup_url at the facilitator manifest, for a buyer with no tooling', () => {
    const body = build402({ cfg, payTo: ROUTER, attributionToken: '', buyerAgentId: null })
    expect(body.extensions.setup_url).toBe(
      'http://127.0.0.1:8082/.well-known/referrer-agent',
    )
  })

  it('names the referral route as the resource, which is the registered endpoint_url', () => {
    const body = build402({ cfg, payTo: ROUTER, attributionToken: '', buyerAgentId: null })
    expect(body.resource.url).toBe('https://api.example.com/buy/referral')
  })

  it('is x402 version 2', () => {
    expect(build402({ cfg, payTo: ROUTER, attributionToken: '', buyerAgentId: null }).x402Version).toBe(2)
  })
})
