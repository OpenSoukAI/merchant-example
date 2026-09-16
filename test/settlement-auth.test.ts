import { describe, expect, it } from 'vitest'
import { recoverMessageAddress } from 'viem'
import {
  createSettlementSigner,
  settlementPayloadHash,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from '../src/settlement-auth.ts'

/**
 * Produced by the facilitator's OWN Go path — `crypto.Sign(accounts.TextHash(keccak256(body
 * || uint64_be(ts))))` in go-ethereum — for anvil account #0, a publicly known test key.
 *
 * Pinned rather than recomputed here because the thing that can break is precisely an
 * agreement between two languages: viem and go-ethereum each look right in isolation while
 * disagreeing about byte order, UTF-8 encoding or the EIP-191 prefix length. A test that
 * derives the expectation from the same viem call it is testing cannot see any of that.
 */
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const BODY = '{"x402Version":2,"paymentPayload":{"a":1},"paymentRequirements":{"scheme":"exact"}}'
const TIMESTAMP = 1750000000
const PAYLOAD_HASH = '0x490d3f0aaabd4b76d70000ccb11530aafaa9a517ee9741e35a7259f773cef5df'
const SIGNATURE =
  '0xc77c9d7a2f85d0b9cf57c82e4a505c2a77ee505316aaabca6bc9486de9886ff9' +
  '7d6c086e4dd702a799ff31c50b0e306988c74a67c531de6774ce6a9bd57c4fca1b'

describe('settlementPayloadHash', () => {
  it('matches the hash the facilitator computes in Go', () => {
    expect(settlementPayloadHash(BODY, TIMESTAMP)).toBe(PAYLOAD_HASH)
  })

  it('encodes the timestamp as 8 big-endian bytes, not as text', () => {
    // A little-endian or decimal-string encoding still produces a 32-byte hash that looks
    // fine locally; only the far side notices. These two differ under every wrong encoding
    // that swaps byte order, because 1 and 2^56 share the same bytes in the other order.
    expect(settlementPayloadHash(BODY, 1)).not.toBe(settlementPayloadHash(BODY, 2 ** 56))
  })

  it('covers the body, so one changed byte changes the hash', () => {
    expect(settlementPayloadHash(`${BODY} `, TIMESTAMP)).not.toBe(PAYLOAD_HASH)
  })
})

describe('createSettlementSigner', () => {
  it('produces the signature the facilitator produced in Go for the same input', async () => {
    const signer = createSettlementSigner(KEY, { now: () => TIMESTAMP })
    const headers = await signer.sign(BODY)
    expect(headers[SIGNATURE_HEADER]).toBe(SIGNATURE)
    expect(headers[TIMESTAMP_HEADER]).toBe(String(TIMESTAMP))
  })

  it('signs so the facilitator recovers the signer address', async () => {
    const signer = createSettlementSigner(KEY, { now: () => TIMESTAMP })
    const headers = await signer.sign(BODY)
    const recovered = await recoverMessageAddress({
      message: { raw: settlementPayloadHash(BODY, TIMESTAMP) },
      signature: headers[SIGNATURE_HEADER] as `0x${string}`,
    })
    expect(recovered).toBe(ADDRESS)
  })

  it('exposes the address an operator must grant SETTLEMENT_SIGNER_ROLE to', () => {
    expect(createSettlementSigner(KEY).address).toBe(ADDRESS)
  })

  it('stamps the current second when no clock is injected', async () => {
    const before = Math.floor(Date.now() / 1000)
    const headers = await createSettlementSigner(KEY).sign(BODY)
    const stamped = Number(headers[TIMESTAMP_HEADER])
    expect(stamped).toBeGreaterThanOrEqual(before)
    expect(stamped).toBeLessThanOrEqual(Math.floor(Date.now() / 1000))
  })

  it('rejects a key that is not 32 bytes of hex, at construction', () => {
    // Before the first sale rather than during it: a malformed key that only fails on the
    // first buyer's request turns a typo into a lost sale.
    expect(() => createSettlementSigner('0xabc' as never)).toThrow()
  })
})
