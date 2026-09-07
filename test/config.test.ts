import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadConfig, MissingConfigError } from '../src/config.ts'

const complete = {
  MERCHANT_PORT: '8083',
  MERCHANT_RPC_URL: 'http://127.0.0.1:8545',
  MERCHANT_ADDRESS_REGISTRY: '0x1111111111111111111111111111111111111111',
  MERCHANT_USDC: '0x2222222222222222222222222222222222222222',
  MERCHANT_NETWORK: 'eip155:8453',
  MERCHANT_PRICE_BASE_UNITS: '1000000',
  MERCHANT_FACILITATOR_URL: 'http://127.0.0.1:8082',
  MERCHANT_PUBLIC_URL: 'http://127.0.0.1:8083',
  MERCHANT_DIRECT_PAY_TO: '0x3333333333333333333333333333333333333333',
}

describe('loadConfig', () => {
  it('reads a complete environment', () => {
    const cfg = loadConfig(complete)
    expect(cfg.port).toBe(8083)
    expect(cfg.network).toBe('eip155:8453')
    expect(cfg.priceBaseUnits).toBe('1000000')
  })

  it('defaults the port but nothing else', () => {
    const { MERCHANT_PORT, ...rest } = complete
    expect(loadConfig(rest).port).toBe(8083)
  })

  it('names every missing variable at once, rather than the first', () => {
    try {
      loadConfig({})
      throw new Error('expected loadConfig to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(MissingConfigError)
      expect((err as MissingConfigError).missing).toEqual([
        'MERCHANT_ADDRESS_REGISTRY',
        'MERCHANT_DIRECT_PAY_TO',
        'MERCHANT_FACILITATOR_URL',
        'MERCHANT_NETWORK',
        'MERCHANT_PRICE_BASE_UNITS',
        'MERCHANT_PUBLIC_URL',
        'MERCHANT_RPC_URL',
        'MERCHANT_USDC',
      ])
    }
  })

  it('sorts the missing list, whatever order the code declares them in', () => {
    // REQUIRED is declared non-alphabetically on purpose. These two are declared
    // USDC-then-NETWORK and sort NETWORK-then-USDC, so this test fails if `.sort()`
    // is ever removed.
    const { MERCHANT_USDC: _u, MERCHANT_NETWORK: _n, ...rest } = complete
    try {
      loadConfig(rest)
      throw new Error('expected loadConfig to throw')
    } catch (err) {
      // USDC is declared BEFORE NETWORK but sorts AFTER it, so without `.sort()`
      // this comes back as [USDC, NETWORK] and the assertion fails.
      expect((err as MissingConfigError).missing).toEqual([
        'MERCHANT_NETWORK',
        'MERCHANT_USDC',
      ])
    }
  })

  it('rejects a price that is not an integer string of base units', () => {
    expect(() => loadConfig({ ...complete, MERCHANT_PRICE_BASE_UNITS: '1.5' })).toThrow(
      /base units/,
    )
  })
})

describe('the start script', () => {
  // loadConfig reads process.env and nothing else, so the `.env` the README tells
  // you to create is read only if the start script hands it to Node. Without the
  // flag, `cp .env.example .env && npm start` exits 1 naming all eight variables
  // the merchant just filled in. Node's own loader, so no dotenv dependency.
  it('hands .env to Node, which is the only thing that reads it', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { scripts: { start: string } }
    // `-if-exists`, not plain `--env-file`: the plain flag makes a missing `.env`
    // a hard `node: .env: not found`, so a merchant using real environment
    // variables instead of a file could not start the server at all.
    expect(pkg.scripts.start).toMatch(/--env-file-if-exists=\.env\b/)
  })
})
