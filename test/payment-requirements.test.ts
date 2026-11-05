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
  MERCHANT_API_URL: 'http://127.0.0.1:8080',
  MERCHANT_PUBLIC_URL: 'https://api.example.com',
  MERCHANT_DIRECT_PAY_TO: '0x3333333333333333333333333333333333333333',
  MERCHANT_SIGNER_PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
})
const ROUTER = '0x4444444444444444444444444444444444444444' as const

describe('buildRequirements', () => {
  it('names the split router as the payment target', () => {
    expect(buildRequirements(cfg, ROUTER, '/buy/referral').payTo).toBe(ROUTER)
  })

  // The fourth integration field (REF-563). A buyer may pay here with a ref link minted for any
  // product of this merchant; the facilitator finds the product registered at this path, so the
  // sale is recorded as the product actually bought, at its commission rate.
  it('reports the path it serves, so any of the merchant’s ref links can be paid here', () => {
    const { extra } = buildRequirements(cfg, ROUTER, '/buy/referral')
    expect(extra.endpoint).toBe('/buy/referral')
    // Retired: the facilitator rejects any payment that still carries it (REF-560).
    expect('productId' in extra).toBe(false)
  })

  it("carries USDC's EIP-712 domain, without which the facilitator cannot recover the signature", () => {
    const { extra } = buildRequirements(cfg, ROUTER, '/buy/referral')
    expect(extra.name).toBe('USD Coin')
    expect(extra.version).toBe('2')
  })

  it('names ReceiveWithAuthorization, not the x402 default', () => {
    // The literal on both lines. Asserting the emitted field against the constant
    // compares the code to itself and holds for any value the constant takes.
    expect(AUTHORIZATION_TYPE).toBe('ReceiveWithAuthorization')
    expect(buildRequirements(cfg, ROUTER, '/buy/referral').extra.authorizationType).toBe('ReceiveWithAuthorization')
  })

  it('passes the price through as a string of base units', () => {
    expect(buildRequirements(cfg, ROUTER, '/buy/referral').amount).toBe('1000000')
  })

  it('advertises the only scheme this rail settles', () => {
    expect(buildRequirements(cfg, ROUTER, '/buy/referral').scheme).toBe('exact')
  })

  it('names the configured token and chain, not a hardcoded pair', () => {
    // `asset` is the contract the hardcoded EIP-712 domain above describes: name the
    // wrong one and every signature recovery fails against a different token.
    const requirements = buildRequirements(cfg, ROUTER, '/buy/referral')
    expect(requirements.asset).toBe('0x2222222222222222222222222222222222222222')
    expect(requirements.network).toBe('eip155:8453')
  })

  it("leaves 60 seconds for the buyer's signing window", () => {
    expect(buildRequirements(cfg, ROUTER, '/buy/referral').maxTimeoutSeconds).toBe(60)
  })

  it('carries the facilitator URL a tool-less buyer settles through', () => {
    expect(buildRequirements(cfg, ROUTER, '/buy/referral').extra.facilitatorUrl).toBe('http://127.0.0.1:8082')
  })
})

describe('build402', () => {
  it('echoes the attribution token verbatim', () => {
    const body = build402({ cfg, payTo: ROUTER, endpoint: '/buy/referral', attributionToken: 'eyJ2Ijo0', buyerAgentId: '7' })
    expect(body.extensions.attributionToken).toBe('eyJ2Ijo0')
    expect(body.extensions.buyerAgentId).toBe('7')
  })

  it('omits buyerAgentId entirely when the buyer sent none, rather than sending empty', () => {
    const body = build402({ cfg, payTo: ROUTER, endpoint: '/buy/referral', attributionToken: '', buyerAgentId: null })
    expect('buyerAgentId' in body.extensions).toBe(false)
  })

  // This test used to assert the facilitator's host, and named it as the correct
  // one. It is not: only the API serves /.well-known/opensouk, and against
  // a live stack the facilitator answered 404 there while the API answered 200.
  // The one reader setup_url exists for is a buyer that has just failed to pay,
  // so a 404 dead-ends exactly the case the field is in the 402 to rescue.
  it('points setup_url at the API, which is the only host serving the manifest', () => {
    const body = build402({ cfg, payTo: ROUTER, endpoint: '/buy/referral', attributionToken: '', buyerAgentId: null })
    expect(body.extensions.setup_url).toBe('http://127.0.0.1:8080/.well-known/opensouk')
    expect(body.extensions.setup_url).not.toContain(cfg.facilitatorUrl)
  })

  it('names the referral route as the resource, which is the registered endpoint_url', () => {
    const body = build402({ cfg, payTo: ROUTER, endpoint: '/buy/referral', attributionToken: '', buyerAgentId: null })
    expect(body.resource.url).toBe('https://api.example.com/buy/referral')
  })

  it('is x402 version 2', () => {
    expect(build402({ cfg, payTo: ROUTER, endpoint: '/buy/referral', attributionToken: '', buyerAgentId: null }).x402Version).toBe(2)
  })
})
